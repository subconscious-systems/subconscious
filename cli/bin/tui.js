import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentList } from './agents.js';
import { getApiKey } from './auth.js';
import { resolveModelCatalog } from './models.js';
import {
  DEFAULT_PROFILE,
  listProfiles,
  loadProfile,
  resolvedModelSetting,
  RUNBOOK_DEFAULTS,
  SUPPORTED_MODELS as PACKAGED_MODELS,
} from './profiles.js';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const TUI_SOURCE_DIR = path.resolve(BIN_DIR, '../tui');

export function nativeTargetName(platform = process.platform, arch = process.arch) {
  const goArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  if (!goArch || !['darwin', 'linux', 'win32'].includes(platform)) return null;
  const goOS = platform === 'win32' ? 'windows' : platform;
  const extension = platform === 'win32' ? '.exe' : '';
  return `subc-tui-${goOS}-${goArch}${extension}`;
}

export function isTuiResult(result) {
  return (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray(result.args) &&
    result.args.every((arg) => typeof arg === 'string') &&
    (result.baseUrl === undefined || typeof result.baseUrl === 'string')
  );
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function resolveTuiExecutable(options = {}) {
  const override = options.binary || process.env.SUBC_TUI_BIN?.trim();
  if (override) return { command: override, args: [], cwd: undefined };

  const target = nativeTargetName(options.platform, options.arch);
  if (target) {
    const packaged = path.join(BIN_DIR, 'native', target);
    if (await pathExists(packaged)) {
      return { command: packaged, args: [], cwd: undefined };
    }
  }

  // Source checkouts can run the TUI without committing native build output.
  // Published packages always contain a prebuilt platform binary.
  if (await pathExists(path.join(TUI_SOURCE_DIR, 'go.mod'))) {
    return {
      command: 'go',
      args: ['run', './cmd/subc-tui'],
      cwd: TUI_SOURCE_DIR,
    };
  }
  return null;
}

function selectedModelFor(profile) {
  return resolvedModelSetting(process.env.SUBCONSCIOUS_MODEL || profile.values.MODEL);
}

function subagentModelFor(profile) {
  return resolvedModelSetting(profile.values.CLAUDE_CODE_SUBAGENT_MODEL);
}

function gatewayFor(profile) {
  return (
    process.env.SUBCONSCIOUS_BASE_URL?.trim() ||
    profile.values.GATEWAY_URL?.trim() ||
    RUNBOOK_DEFAULTS.GATEWAY_URL
  ).replace(/\/+$/, '');
}

async function packageVersion() {
  const pkg = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'),
  );
  return pkg.version;
}

export async function createTuiState(profileName = DEFAULT_PROFILE, options = {}) {
  const activeProfile = options.profile || (await loadProfile(profileName));
  const names = [...new Set([profileName, ...(await listProfiles())])].sort((a, b) => {
    if (a === profileName) return -1;
    if (b === profileName) return 1;
    return a.localeCompare(b);
  });
  const profiles = await Promise.all(
    names.map(async (name) => {
      const profile = name === profileName ? activeProfile : await loadProfile(name);
      const auth = await getApiKey(profile);
      return {
        name,
        model: selectedModelFor(profile),
        subagentModel: subagentModelFor(profile),
        authenticated: Boolean(auth?.key),
      };
    }),
  );

  const auth = await getApiKey(activeProfile);
  const requestedModel = selectedModelFor(activeProfile);
  const gatewayUrl = gatewayFor(activeProfile);
  const catalog = await resolveModelCatalog({
    baseUrl: gatewayUrl,
    apiKey: auth?.key,
    selectedModel: requestedModel,
    fallbackModels: PACKAGED_MODELS,
  });
  const selectedModel = requestedModel;

  return {
    version: await packageVersion(),
    activeProfile: profileName,
    profilePath: activeProfile.path,
    profiles,
    models: catalog.models,
    selectedModel,
    subagentModel: subagentModelFor(activeProfile),
    gatewayUrl,
    savedGatewayUrl:
      activeProfile.values.GATEWAY_URL?.trim().replace(/\/+$/, '') ||
      RUNBOOK_DEFAULTS.GATEWAY_URL,
    gatewayOverridden: Boolean(process.env.SUBCONSCIOUS_BASE_URL?.trim()),
    modelError: catalog.error?.message || '',
    modelSource: catalog.source,
    agents: agentList().map((agent) => ({
      command: agent.alias,
      name: agent.name,
      action: agent.action,
      description: agent.description,
      launch: agent.launch,
    })),
  };
}

function spawnAndWait(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Subconscious TUI exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export async function runTui(options = {}) {
  const executable = await resolveTuiExecutable(options);
  if (!executable) return null;

  const state = options.state || (await createTuiState(options.profileName, options));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-'));
  const statePath = path.join(tempDir, 'state.json');
  const resultPath = path.join(tempDir, 'result.json');

  try {
    // This state intentionally contains only display data. API keys are used
    // by the Node command engine and are never passed into the TUI process.
    await fs.writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    const code = await spawnAndWait(
      executable.command,
      [...executable.args, '--state', statePath, '--result', resultPath],
      { cwd: executable.cwd },
    );
    if (code !== 0) throw new Error(`Subconscious TUI exited with status ${code}`);

    try {
      const result = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
      return isTuiResult(result) ? result : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
