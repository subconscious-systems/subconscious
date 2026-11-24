import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
export const GOOD_KEY = 'sk-sandbox-good-0123456789';
export const MODELS = ['subconscious/sandbox-a', 'subconscious/sandbox-b'];

/**
 * A fake agent CLI, as a Node script. Every fake reads its options from
 * FAKE_<NAME>_* names, such as FAKE_CODEX_LOG. A lone `--version` or `-v`
 * writes one file where the real CLI writes on every start, so a test can
 * see which dir a version check used, and prints `versionLine` with
 * FAKE_<NAME>_VERSION, or `version` without it. Any other call reads stdin
 * when READ_STDIN is 1, and appends its argv, env, stdin, cwd, pid, ppid,
 * and the fields of `record` to the LOG file. Then `body` runs.
 */
function fakeAgent(
  name,
  { version, versionLine, versionFile, record = '{}', body },
) {
  const prefix = `FAKE_${name.toUpperCase()}_`;
  return `#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const args = process.argv.slice(2);
const option = (key) => process.env['${prefix}' + key];
if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  const file = ${versionFile};
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, 'version check\\n');
  const version = option('VERSION') || '${version}';
  process.stdout.write(${versionLine} + '\\n');
  process.exit(0);
}
const stdin = option('READ_STDIN') === '1' ? fs.readFileSync(0, 'utf8') : '';
const record = { args, env: process.env, stdin, cwd: process.cwd(), pid: process.pid, ppid: process.ppid, ...${record} };
if (option('LOG')) fs.appendFileSync(option('LOG'), JSON.stringify(record) + '\\n');
${body}
`;
}

// The fake prints exactly one line, then stays alive for SLEEP ms, as a
// long-lived agent would be.
const printAndSleep = (
  line,
) => `process.stdout.write(JSON.stringify(${line}) + '\\n');
if (option('SLEEP')) setTimeout(() => {}, Number(option('SLEEP')));`;

// A fake codex. Its version check writes under CODEX_HOME/tmp, as the real
// Codex does on every start. A launch records the catalog it was given and
// prints one JSON line.
const FAKE_CODEX = fakeAgent('codex', {
  version: '0.167.2',
  versionLine: "'codex-cli ' + version",
  versionFile:
    "path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'tmp', 'fake-version-check')",
  record: `(() => {
  const arg = args.find((value) => value.startsWith('model_catalog_json='));
  const catalogPath = arg && arg.slice('model_catalog_json='.length);
  return { catalogPath, catalog: catalogPath ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : null };
})()`,
  body: printAndSleep("{ fake: 'codex', args }"),
});

// A fake claude. Its version check writes in its config dir,
// CLAUDE_CONFIG_DIR or ~/.claude. A launch prints a result line for -p and
// an init message for stream-json.
const FAKE_CLAUDE = fakeAgent('claude', {
  version: '2.1.326',
  versionLine: "version + ' (Claude Code)'",
  versionFile:
    "path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'fake-version-check')",
  body: printAndSleep(
    "args.includes('-p') || args.includes('--print') ? { type: 'result', subtype: 'success', result: 'fake', fake: 'claude' } : { type: 'system', subtype: 'init', fake: 'claude' }",
  ),
});

// A fake opencode. Its version check writes its log under XDG_DATA_HOME, as
// the real OpenCode does. A launch records the parsed launch config. Only
// `serve` prints the one line T3 Code waits for, then runs for SLEEP ms.
// IGNORE_TERM=1 makes it ignore SIGTERM, and CHILD=1 makes it start a long
// `sleep` child in its process group, like a tool or an MCP server.
const FAKE_OPENCODE = fakeAgent('opencode', {
  version: '2.3.0',
  versionLine: "'opencode v' + version",
  versionFile:
    "path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'log', 'opencode.log')",
  record: `(() => {
  let config = null;
  try {
    config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
  } catch {}
  const childPid = option('CHILD') === '1' && args[0] === 'serve'
    ? require('child_process').spawn('sleep', ['600'], { stdio: 'ignore' }).pid
    : null;
  return { config, childPid };
})()`,
  body: `if (args[0] !== 'serve' || args.includes('--help') || args.includes('-h')) {
  process.stdout.write('opencode ' + args.join(' ') + ': usage\\n');
  process.exit(0);
}
process.on('SIGTERM', () => {
  if (option('IGNORE_TERM') !== '1') process.exit(0);
});
process.stdout.write('server listening on http://127.0.0.1:4096\\n');
if (option('SLEEP')) setTimeout(() => process.exit(0), Number(option('SLEEP')));`,
});

// The user's own Claude Code files. Install and launches must leave them as
// they are.
const USER_CLAUDE_SETTINGS = `${JSON.stringify({ model: 'opus', env: { USER_SETTING: '1' } }, null, 2)}\n`;
const USER_CLAUDE_JSON = `${JSON.stringify({ projects: { '/x': { hasTrustDialogAccepted: true } } }, null, 2)}\n`;

const shellWord = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/** A local gateway: the canonical catalog for GOOD_KEY, 401 for any other. */
export async function fakeGateway() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization ?? null,
        body,
      });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        if (!req.headers.authorization) {
          res.end(JSON.stringify({ data: [{ id: 'public/listed-model' }] }));
          return;
        }
        if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'invalid key' }));
          return;
        }
        res.end(
          JSON.stringify({
            data: MODELS.map((id) => ({ id, schema_version: '1' })),
          }),
        );
        return;
      }
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A HOME with a space in its path, a T3 home with settings, a default
 * profile, a fake codex, and an existing ordinary ~/.codex. Nothing outside
 * `root` is read or written by the commands a test runs with `env`.
 */
export async function t3Sandbox({
  gateway,
  apiKey = GOOD_KEY,
  settings,
  withClaude = false,
  withOpenCode = false,
} = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-t3-test-')),
  );
  const home = path.join(root, 'home with space');
  const bin = path.join(root, 'fake bin');
  const tmp = path.join(root, 'tmp');
  // Only node, not the rest of its directory: an npm-installed opencode or
  // npm itself there would let install find the real OpenCode.
  const nodeBin = path.join(root, 'node bin');
  const t3Home = path.join(home, '.t3');
  const subc = path.join(home, '.subconscious');
  for (const dir of [bin, tmp, nodeBin, path.join(t3Home, 'userdata')])
    await fs.mkdir(dir, { recursive: true });
  await fs.symlink(process.execPath, path.join(nodeBin, 'node'));
  // subc looks for agents in the npm global bin. The real npm would name
  // the prefix of the Node that runs it, where a real OpenCode can live.
  await fs.writeFile(
    path.join(bin, 'npm'),
    `#!/bin/sh\nif [ "$1" = prefix ] && [ "$2" = -g ]; then echo ${shellWord(path.join(root, 'npm global'))}; exit 0; fi\nexit 1\n`,
    { mode: 0o755 },
  );
  await fs.mkdir(path.join(subc, 'profiles'), { recursive: true });
  await fs.writeFile(path.join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 });
  await fs.writeFile(
    path.join(subc, 'profiles', 'default.env'),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=${apiKey}\nMODEL=UNSET\n`,
    { mode: 0o600 },
  );
  const settingsPath = path.join(t3Home, 'userdata', 'settings.json');
  await fs.writeFile(
    settingsPath,
    settings ??
      `${JSON.stringify(
        {
          projectSettingsFolded: true,
          futureTopLevelSetting: { keep: [1, 2, 3] },
          providerInstances: {
            claudeAgent: { driver: 'claudeAgent', enabled: true },
          },
        },
        null,
        '\t',
      )}\n`,
    { mode: 0o644 },
  );
  const codexDir = path.join(home, '.codex');
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(
    path.join(codexDir, 'config.toml'),
    'model = "gpt-user"\n[mcp_servers.user]\ncommand = "user-mcp"\n',
  );
  // With withClaude, a fake Claude Code installed the way the native
  // installer does it: ~/.local/bin/claude links to a versioned file.
  const claudeDir = path.join(home, '.claude');
  const claudeJson = path.join(home, '.claude.json');
  const claudeBin = path.join(home, '.local', 'bin', 'claude');
  const claudeVersions = path.join(
    home,
    '.local',
    'share',
    'claude',
    'versions',
  );
  if (withClaude) {
    await fs.mkdir(path.dirname(claudeBin), { recursive: true });
    await fs.mkdir(claudeVersions, { recursive: true });
    const versioned = path.join(claudeVersions, '2.1.326');
    await fs.writeFile(versioned, FAKE_CLAUDE, { mode: 0o755 });
    await fs.symlink(versioned, claudeBin);
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, 'settings.json'),
      USER_CLAUDE_SETTINGS,
    );
    await fs.writeFile(claudeJson, USER_CLAUDE_JSON);
  }
  // With withOpenCode, a fake OpenCode installed by npm into the fake bin.
  const opencodeBin = path.join(bin, 'opencode');
  if (withOpenCode)
    await fs.writeFile(opencodeBin, FAKE_OPENCODE, { mode: 0o755 });
  const PATH = [
    bin,
    nodeBin,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ].join(path.delimiter);
  const env = {
    PATH,
    HOME: home,
    TMPDIR: tmp,
    LANG: 'C',
    SUBC_DISABLE_UPDATE_CHECK: '1',
  };
  const paths = {
    root,
    home,
    bin,
    tmp,
    t3Home,
    settingsPath,
    codexDir,
    subc,
    launcher: path.join(subc, 'bin', 'subc-t3-codex'),
    codexHome: codexDir,
    catalogDir: path.join(subc, 't3', 'codex', 'catalog'),
    // subc 8.2.0 wrote this file; nothing reads it now.
    state: path.join(subc, 't3', 'state.json'),
    claudeDir,
    claudeJson,
    claudeBin,
    claudeLauncher: path.join(subc, 'bin', 'subc-t3-claude'),
    opencodeBin,
    opencodeLauncher: path.join(subc, 'bin', 'subc-t3-opencode'),
    // The user's own OpenCode folders. Install and launches write nothing
    // there.
    opencodeConfigDir: path.join(home, '.config', 'opencode'),
    opencodeDataDir: path.join(home, '.local', 'share', 'opencode'),
  };
  return {
    ...paths,
    env,
    // How T3 Code starts its Codex binary: its own env, the instance's home,
    // and, here, every override a hostile environment could carry.
    t3Env(extra = {}) {
      return {
        ...env,
        CODEX_HOME: paths.codexHome,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 't3code',
        SUBCONSCIOUS_API_KEY: 'sk-inherited-evil',
        SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9/evil',
        SUBCONSCIOUS_MODELS: 'evil/pinned-model',
        SUBCONSCIOUS_MODEL: 'evil/model',
        SUBC_CONFIG_DIR: path.join(root, 'evil-config'),
        SUBC_MODEL_METADATA: '[]',
        CODEX_API_KEY: 'sk-codex-evil',
        ...extra,
      };
    },
    // How T3 Code 0.1.11 starts its Claude binary with no homePath: its own
    // env plus the protocol names it adds, and no CLAUDE_CONFIG_DIR.
    claudeT3Env(extra = {}) {
      return {
        ...env,
        CLAUDE_CODE_ENTRYPOINT: 't3-code',
        CLAUDE_AGENT_SDK_VERSION: '0.3.321',
        CLAUDE_CODE_SDK_READS_SESSION_STATE: '1',
        ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
        CLAUDE_CODE_AUTO_CONNECT_IDE: 'false',
        CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
        MISE_OFFLINE: '1',
        T3CODE_THREAD_ID: 'thread-1',
        ...extra,
      };
    },
    // How T3 Code 0.1.11 starts its OpenCode helper: its own env, the
    // password it made for the helper, and an empty config.
    openCodeT3Env(extra = {}) {
      return {
        ...env,
        T3CODE_HOME: t3Home,
        OPENCODE_PASSWORD: 't3-helper-password-0123',
        OPENCODE_CONFIG_CONTENT: '{}',
        ...extra,
      };
    },
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

/** Run a command; resolves with code, signal, stdout, stderr, and pid. */
export function run(file, args, { env, input, cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, pid: child.pid });
    });
  });
}

export function subc(box, args, extraEnv = {}) {
  return run(process.execPath, [CLI, ...args], {
    env: { ...box.env, ...extraEnv },
  });
}

export async function readRecords(file) {
  try {
    return (await fs.readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Every file under `dir` with its size and mtime, for no-write checks.
 * `~/.npm` is left out: finding Codex runs `npm prefix -g`, as every subc
 * launch does, and npm writes its own debug log there.
 */
export async function snapshot(dir) {
  const entries = {};
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (current === dir && entry.name === '.npm') continue;
      const full = path.join(current, entry.name);
      const stat = await fs.lstat(full);
      entries[path.relative(dir, full)] = `${stat.size}:${stat.mtimeMs}`;
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return entries;
}

/**
 * The 14 built-in Claude models that T3 Code 0.1.11 lists on every
 * claudeAgent instance (step 0, November 23, 2026). Each has a display name.
 */
export const BUILT_IN_CLAUDE_MODELS = Object.freeze([
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-fable-5-2', 'Claude Fable 5.2'],
  ['claude-fable-5-1', 'Claude Fable 5.1'],
  ['claude-fable-5', 'Claude Fable 5'],
  ['claude-opus-5', 'Claude Opus 5'],
  ['claude-opus-4-8', 'Claude Opus 4.8'],
  ['claude-opus-4-7', 'Claude Opus 4.7'],
  ['claude-opus-4-6', 'Claude Opus 4.6'],
  ['claude-opus-4-5', 'Claude Opus 4.5'],
  ['claude-sonnet-5', 'Claude Sonnet 5'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'],
]);

/**
 * Write a T3 Code 0.1.11 model cache, `caches/<instance id>.json`, mode
 * 600: the provider snapshot, with the fields that subc reads. Built-in
 * models and models that Claude Code reports look the same.
 */
export async function writeT3ModelCache(
  box,
  {
    instanceId,
    builtIns = BUILT_IN_CLAUDE_MODELS.map(([slug]) => slug),
    reported = [],
    checkedAt = new Date().toISOString(),
    status = 'ready',
    auth = { status: 'authenticated', type: 'apiKey' },
    message,
  },
) {
  const dir = path.join(box.t3Home, 'caches');
  await fs.mkdir(dir, { recursive: true });
  const models = [...builtIns, ...reported].map((slug) => ({ slug }));
  await fs.writeFile(
    path.join(dir, `${instanceId}.json`),
    JSON.stringify({ instanceId, status, auth, message, checkedAt, models }),
    { mode: 0o600 },
  );
}

/**
 * Exported bash functions as T3 Code's env could carry them, for example
 * from `export -f cd`. Each one writes a marker file and prints, so a test
 * sees whether any shell ran it.
 */
export function exportedFunctions(marker) {
  const body = (name) =>
    `() { echo ${name} >> '${marker}'; echo HIJACKED-${name}; }`;
  return {
    'BASH_FUNC_cd%%': body('cd'),
    'BASH_FUNC_dirname%%': body('dirname'),
  };
}
