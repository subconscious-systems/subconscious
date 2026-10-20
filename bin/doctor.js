/**
 * `subc doctor` — check everything a launch depends on and say how to fix
 * what is broken: the CLI and Node versions, the profile, the API key, the
 * gateway and its model catalog, each coding agent, and the tools the
 * runbooks call.
 *
 * Every check only reads. Nothing is installed, written, or launched, and the
 * API key is never printed, so the report is safe to paste into a bug report.
 */

import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AGENTS,
  agentBinary,
  agentCommandName,
  installAdvice,
} from './agent-data.js';
import {
  preferredBinDirsForAgent,
  readClaudeVersion,
  resolveBinPath,
  versionNeedsUpgrade,
} from './agent-install.js';
import { getApiKey, getPlatformUrl } from './auth.js';
import { c } from './colors.js';
import { isLiveModelSource, resolveModelCatalog } from './models.js';
import {
  DEFAULT_PROFILE,
  SUPPORTED_MODELS as PACKAGED_MODELS,
  RUNBOOK_DEFAULTS,
  resolvedModelSetting,
} from './profiles.js';
import {
  compareVersions,
  currentVersion,
  fetchLatestVersion,
} from './update-check.js';

export const DOCTOR_SCHEMA_VERSION = 1;
export const DOCTOR_TIMEOUT_MS = 5000;
const MIN_NODE_MAJOR = 18;

const GROUPS = ['CLI', 'Account', 'Gateway', 'Agents', 'Tools'];

function check(group, id, status, label, extra = {}) {
  return { group, id, status, label, ...extra };
}

function errorMessage(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return 'timed out';
  }
  return error?.cause?.code || error?.message || String(error);
}

/** True when `bin` is an executable in one of the directories on `PATH`. */
export async function isOnPath(
  bin,
  env = process.env,
  platform = process.platform,
) {
  const dirs = (env.PATH || env.Path || '')
    .split(path.delimiter)
    .filter(Boolean);
  const exts =
    platform === 'win32'
      ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        await fs.access(path.join(dir, bin + ext), fsConstants.F_OK);
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

async function cliChecks(deps) {
  const results = [];
  const installed = deps.cliVersion ?? (await currentVersion());
  try {
    const latest = await deps.latestVersion();
    if (compareVersions(installed, latest) < 0) {
      results.push(
        check(
          'CLI',
          'cli-version',
          'warn',
          `subc ${installed} (${latest} is available)`,
          {
            fix: 'subc upgrade',
          },
        ),
      );
    } else {
      results.push(
        check('CLI', 'cli-version', 'ok', `subc ${installed} (latest)`),
      );
    }
  } catch (error) {
    results.push(
      check('CLI', 'cli-version', 'info', `subc ${installed}`, {
        detail: `Could not check npm for a newer release: ${errorMessage(error)}`,
      }),
    );
  }

  const nodeMajor = Number(deps.nodeVersion.replace(/^v/, '').split('.')[0]);
  results.push(
    nodeMajor >= MIN_NODE_MAJOR
      ? check('CLI', 'node-version', 'ok', `Node.js ${deps.nodeVersion}`)
      : check('CLI', 'node-version', 'fail', `Node.js ${deps.nodeVersion}`, {
          detail: `subc needs Node.js ${MIN_NODE_MAJOR} or newer.`,
          fix: 'Install a current Node.js LTS from https://nodejs.org',
        }),
  );

  results.push(
    (await deps.onPath('subc'))
      ? check('CLI', 'cli-path', 'ok', 'subc is on PATH')
      : check('CLI', 'cli-path', 'warn', 'subc is not on PATH', {
          detail:
            'A new shell will not find subc. The curl installer puts it in ~/.local/bin.',
          fix: 'Add the directory that holds subc to PATH, for example: export PATH="$HOME/.local/bin:$PATH"',
        }),
  );
  return results;
}

async function accountChecks(profile, profileName, deps) {
  const flag =
    profileName && profileName !== DEFAULT_PROFILE ? `-p ${profileName} ` : '';
  const results = [];

  if (profile.name !== DEFAULT_PROFILE && !profile.exists) {
    results.push(
      check(
        'Account',
        'profile',
        'fail',
        `Profile '${profile.name}' does not exist`,
        {
          fix: `subc ${flag}config --api-key KEY`,
        },
      ),
    );
  } else {
    results.push(
      check('Account', 'profile', 'ok', `Profile '${profile.name}'`, {
        detail: profile.exists ? profile.path : 'Using built-in defaults.',
      }),
    );
  }

  const auth = await deps.getApiKey(profile);
  if (!auth) {
    results.push(
      check('Account', 'api-key', 'fail', 'No API key', {
        fix: `subc ${flag}login`,
      }),
    );
    return { results, auth };
  }

  const platformUrl = getPlatformUrl(profile);
  const source = { detail: `Key from ${auth.source}` };
  try {
    const res = await deps.fetch(`${platformUrl}/api/cli/whoami`, {
      headers: { Authorization: `Bearer ${auth.key}` },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const org = data?.organization ? ` (${data.organization})` : '';
      results.push(
        check('Account', 'api-key', 'ok', `API key is valid${org}`, source),
      );
    } else if (res.status === 401) {
      results.push(
        check('Account', 'api-key', 'fail', 'API key is invalid or revoked', {
          ...source,
          fix: `subc ${flag}logout && subc ${flag}login`,
        }),
      );
    } else if (res.status === 404) {
      results.push(
        check(
          'Account',
          'api-key',
          'warn',
          'Platform does not support key checks',
          {
            detail: `${platformUrl} has no CLI login API. Check PLATFORM_URL.`,
          },
        ),
      );
    } else {
      // Only a 401 says anything about the key itself.
      results.push(
        check(
          'Account',
          'api-key',
          'warn',
          `Could not verify the API key (HTTP ${res.status})`,
          source,
        ),
      );
    }
  } catch (error) {
    results.push(
      check(
        'Account',
        'api-key',
        'warn',
        'Could not reach the platform to verify the key',
        {
          detail: `${platformUrl}: ${errorMessage(error)}`,
        },
      ),
    );
  }
  return { results, auth };
}

async function gatewayChecks(profile, auth, deps) {
  const baseUrl =
    deps.env.SUBCONSCIOUS_BASE_URL?.trim() ||
    profile.values.GATEWAY_URL?.trim() ||
    RUNBOOK_DEFAULTS.GATEWAY_URL;
  const selectedModel = resolvedModelSetting(
    deps.env.SUBCONSCIOUS_MODEL || profile.values.MODEL,
  );

  const started = deps.now();
  const catalog = await resolveModelCatalog({
    baseUrl,
    apiKey: auth?.key,
    selectedModel,
    fallbackModels: PACKAGED_MODELS,
    fetchImpl: deps.fetch,
    timeoutMs: deps.timeoutMs,
  });
  const elapsed = Math.round(deps.now() - started);
  const count = `${catalog.models.length} model${catalog.models.length === 1 ? '' : 's'}`;

  const results = [];
  if (catalog.source === 'available') {
    results.push(
      check(
        'Gateway',
        'gateway',
        'ok',
        `Gateway reachable in ${elapsed}ms (${count} for your key)`,
        {
          detail: baseUrl,
        },
      ),
    );
  } else if (catalog.source === 'public') {
    results.push(
      check(
        'Gateway',
        'gateway',
        auth ? 'warn' : 'ok',
        `Gateway reachable in ${elapsed}ms (${count}, public list)`,
        {
          detail: auth
            ? `${baseUrl} did not return the models for your key, so launches use the public list.`
            : baseUrl,
        },
      ),
    );
  } else {
    results.push(
      check('Gateway', 'gateway', 'fail', 'Gateway is unreachable', {
        detail: `${baseUrl}: ${errorMessage(catalog.error)}`,
        fix: 'Check your network, or the gateway URL with subc update-url',
      }),
    );
  }

  if (deps.env.SUBCONSCIOUS_MODELS?.trim()) {
    results.push(
      check(
        'Gateway',
        'pinned-models',
        'info',
        'SUBCONSCIOUS_MODELS pins the launch catalog',
        {
          detail:
            'Launches use the pinned list instead of what the gateway serves.',
        },
      ),
    );
  }

  if (!selectedModel) {
    const first = isLiveModelSource(catalog.source) ? catalog.models[0] : null;
    results.push(
      check('Gateway', 'model', 'ok', 'Model is UNSET', {
        detail: first
          ? `Launches use the first catalog model, ${first}.`
          : 'Launches use the first catalog model.',
      }),
    );
  } else if (!isLiveModelSource(catalog.source)) {
    results.push(
      check('Gateway', 'model', 'info', `Model ${selectedModel}`, {
        detail: 'Not checked: the live catalog is unavailable.',
      }),
    );
  } else if (catalog.models.includes(selectedModel)) {
    results.push(
      check('Gateway', 'model', 'ok', `Model ${selectedModel} is served`),
    );
  } else {
    results.push(
      check(
        'Gateway',
        'model',
        'warn',
        `Model ${selectedModel} is not in the gateway catalog`,
        {
          detail: `Served: ${catalog.models.slice(0, 5).join(', ')}${catalog.models.length > 5 ? ', …' : ''}`,
          fix: 'subc models, then subc config edit to change MODEL',
        },
      ),
    );
  }
  return results;
}

async function agentCheck(agent, deps) {
  const bin = agentBinary(agent);
  const command = agentCommandName(agent);
  const dir = await deps.findBinary(
    bin,
    preferredBinDirsForAgent(agent, deps.env),
  );
  if (!dir) {
    const { command: install, url } = installAdvice(agent, deps.platform);
    return check(
      'Agents',
      `agent:${agent.id}`,
      'info',
      `${agent.name} is not installed`,
      {
        detail: `Needed only for subc ${command}. ${url}`,
        ...(install ? { fix: install } : {}),
      },
    );
  }

  const minimum = agent.install.minimum_version;
  // npm .cmd shims cannot be run without a shell on Windows, so the version
  // is only read where subc itself reads it before a launch.
  if (!minimum || deps.platform === 'win32') {
    return check(
      'Agents',
      `agent:${agent.id}`,
      'ok',
      `${agent.name} is installed`,
      {
        detail: path.join(dir, bin),
      },
    );
  }

  const version = deps.readVersion(bin, dir);
  if (!version) {
    return check(
      'Agents',
      `agent:${agent.id}`,
      'warn',
      `${agent.name}: could not read its version`,
      {
        detail: `${path.join(dir, bin)} --version failed. subc ${command} needs ${minimum} or newer.`,
      },
    );
  }
  if (versionNeedsUpgrade(version, minimum)) {
    const { command: install } = installAdvice(agent, deps.platform);
    return check(
      'Agents',
      `agent:${agent.id}`,
      'warn',
      `${agent.name} ${version} is older than ${minimum}`,
      {
        detail: path.join(dir, bin),
        ...(install ? { fix: install } : {}),
      },
    );
  }
  return check(
    'Agents',
    `agent:${agent.id}`,
    'ok',
    `${agent.name} ${version}`,
    {
      detail: path.join(dir, bin),
    },
  );
}

/** Group every runbook prerequisite by command, with the agents that use it. */
export function prerequisiteUsers(agents = AGENTS) {
  const users = new Map();
  for (const agent of agents) {
    for (const prerequisite of agent.prerequisites ?? []) {
      const list = users.get(prerequisite.command) ?? [];
      list.push({ agent, ...prerequisite });
      users.set(prerequisite.command, list);
    }
  }
  return users;
}

async function toolChecks(deps) {
  const results = [];
  for (const [command, users] of prerequisiteUsers(deps.agents)) {
    // `a|b` means either command satisfies the prerequisite.
    const alternatives = command.split('|');
    let found = false;
    for (const name of alternatives) {
      if (await deps.findBinary(name, [])) {
        found = true;
        break;
      }
    }
    const label = alternatives.join(' or ');
    if (found) {
      results.push(
        check('Tools', `tool:${command}`, 'ok', `${label} is installed`),
      );
      continue;
    }
    const required = users.filter((user) => user.required);
    const needs = (required.length ? required : users)
      .map((user) => `${user.agent.name} (${user.needed_for})`)
      .join(', ');
    results.push(
      check(
        'Tools',
        `tool:${command}`,
        required.length ? 'warn' : 'info',
        `${label} is not installed`,
        {
          detail: `${required.length ? 'Required' : 'Optional'} for ${needs}.`,
        },
      ),
    );
  }
  return results;
}

function defaultDeps(overrides = {}) {
  const env = overrides.env ?? process.env;
  const platform = overrides.platform ?? process.platform;
  return {
    env,
    platform,
    agents: AGENTS,
    fetch: globalThis.fetch,
    now: () => performance.now(),
    timeoutMs: DOCTOR_TIMEOUT_MS,
    nodeVersion: process.version,
    getApiKey,
    latestVersion: () => fetchLatestVersion({ timeoutMs: DOCTOR_TIMEOUT_MS }),
    findBinary: resolveBinPath,
    readVersion: (bin, dir) => readClaudeVersion(bin, dir),
    onPath: (bin) => isOnPath(bin, env, platform),
    ...overrides,
  };
}

/** Run every check and return the report `subc doctor --json` prints. */
export async function runDoctor({ profile, profileName, ...overrides }) {
  const deps = defaultDeps(overrides);
  const launchAgents = deps.agents.filter((agent) => agentBinary(agent));

  const [cli, account, agents, tools] = await Promise.all([
    cliChecks(deps),
    accountChecks(profile, profileName, deps),
    Promise.all(launchAgents.map((agent) => agentCheck(agent, deps))),
    toolChecks(deps),
  ]);
  const gateway = await gatewayChecks(profile, account.auth, deps);

  const checks = [...cli, ...account.results, ...gateway, ...agents, ...tools];
  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const item of checks) summary[item.status] += 1;
  return {
    schema_version: DOCTOR_SCHEMA_VERSION,
    profile: profile.name,
    platform: deps.platform,
    ok: summary.fail === 0,
    summary,
    checks,
  };
}

const MARKS = {
  ok: () => `${c.green}✓${c.reset}`,
  warn: () => `${c.yellow}!${c.reset}`,
  fail: () => `${c.red}✗${c.reset}`,
  info: () => `${c.dim}·${c.reset}`,
};

export function formatDoctorReport(report) {
  const lines = [
    '',
    `  ${c.bold}subc doctor${c.reset} ${c.dim}profile: ${report.profile}${c.reset}`,
  ];
  for (const group of GROUPS) {
    const items = report.checks.filter((item) => item.group === group);
    if (!items.length) continue;
    lines.push('', `  ${c.bold}${group}${c.reset}`);
    for (const item of items) {
      lines.push(`    ${MARKS[item.status]()} ${item.label}`);
      if (item.detail) lines.push(`      ${c.dim}${item.detail}${c.reset}`);
      if (item.fix) lines.push(`      ${c.cyan}→ ${item.fix}${c.reset}`);
    }
  }

  const { ok, warn, fail } = report.summary;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const color = fail ? c.red : warn ? c.yellow : c.green;
  lines.push(
    '',
    `  ${color}${plural(ok, 'check')} passed, ${plural(warn, 'warning')}, ${fail} failed${c.reset}`,
    '',
  );
  return lines.join('\n');
}

export const DOCTOR_HELP = `
Usage:
  subc doctor
  subc doctor --json
  subc -p <profile> doctor

Check the CLI, profile, API key, gateway, model, coding agents, and the tools
the agents' runbooks need, and print how to fix each problem.

Every check only reads: nothing is installed, configured, or launched, and the
API key is never printed. Exits 1 when a check fails, so scripts and CI can
gate on it. --json prints the report as JSON.
`;

export async function doctorCommand(argv = [], options = {}) {
  const unknown = argv.filter((arg) => arg !== '--json');
  if (unknown.length) {
    throw new Error(`Unknown argument: ${unknown[0]}. Try subc doctor help.`);
  }
  const report = await runDoctor(options);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(formatDoctorReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}
