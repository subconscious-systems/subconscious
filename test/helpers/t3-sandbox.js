import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
export const GOOD_KEY = 'sk-sandbox-good-0123456789';
export const MODELS = ['subconscious/sandbox-a', 'subconscious/sandbox-b'];

// A fake codex: --version creates CODEX_HOME/tmp, as the real Codex does on
// every start, and prints a version; anything else records its argv,
// env, stdin, and the catalog it was given, then prints one JSON line so a
// test can check that stdout carries nothing else. FAKE_CODEX_SLEEP keeps it
// alive in the same process, as a real app-server would be.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  const home = process.env.CODEX_HOME || require('path').join(require('os').homedir(), '.codex');
  fs.mkdirSync(require('path').join(home, 'tmp'), { recursive: true });
  process.stdout.write('codex-cli 0.167.2\\n');
  process.exit(0);
}
let stdin = '';
if (process.env.FAKE_CODEX_READ_STDIN === '1') stdin = fs.readFileSync(0, 'utf8');
const catalogArg = args.find((arg) => arg.startsWith('model_catalog_json='));
const catalogPath = catalogArg && catalogArg.slice('model_catalog_json='.length);
const record = {
  args,
  env: process.env,
  stdin,
  pid: process.pid,
  catalogPath,
  catalog: catalogPath ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : null,
};
if (process.env.FAKE_CODEX_LOG)
  fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(record) + '\\n');
process.stdout.write(JSON.stringify({ fake: 'codex', args }) + '\\n');
if (process.env.FAKE_CODEX_SLEEP) setTimeout(() => {}, Number(process.env.FAKE_CODEX_SLEEP));
`;

// A fake claude. --version prints FAKE_CLAUDE_VERSION (default 2.1.326) and,
// like a real start, writes a file in its config dir (CLAUDE_CONFIG_DIR, or
// ~/.claude), so a test can see which dir a version check used. Any other
// call records its argv, env, stdin, cwd, and pid to FAKE_CLAUDE_LOG, then
// prints exactly one JSON line: a result for -p and an init message for
// stream-json. FAKE_CLAUDE_SLEEP keeps it alive in the same process.
export const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake-version-check'), 'ran\\n');
  process.stdout.write((process.env.FAKE_CLAUDE_VERSION || '2.1.326') + ' (Claude Code)\\n');
  process.exit(0);
}
let stdin = '';
if (process.env.FAKE_CLAUDE_READ_STDIN === '1') stdin = fs.readFileSync(0, 'utf8');
const record = { args, env: process.env, stdin, cwd: process.cwd(), pid: process.pid };
if (process.env.FAKE_CLAUDE_LOG)
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(record) + '\\n');
const print = args.includes('-p') || args.includes('--print');
const line = print
  ? { type: 'result', subtype: 'success', result: 'fake', fake: 'claude' }
  : { type: 'system', subtype: 'init', fake: 'claude' };
process.stdout.write(JSON.stringify(line) + '\\n');
if (process.env.FAKE_CLAUDE_SLEEP) setTimeout(() => {}, Number(process.env.FAKE_CLAUDE_SLEEP));
`;

// The user's own Claude Code files. Install and launches must leave them as
// they are.
export const USER_CLAUDE_SETTINGS = `${JSON.stringify({ model: 'opus', env: { USER_SETTING: '1' } }, null, 2)}\n`;
export const USER_CLAUDE_JSON = `${JSON.stringify({ projects: { '/x': { hasTrustDialogAccepted: true } } }, null, 2)}\n`;

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
} = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-t3-test-')),
  );
  const home = path.join(root, 'home with space');
  const bin = path.join(root, 'fake bin');
  const tmp = path.join(root, 'tmp');
  const t3Home = path.join(home, '.t3');
  const subc = path.join(home, '.subconscious');
  for (const dir of [bin, tmp, path.join(t3Home, 'userdata')])
    await fs.mkdir(dir, { recursive: true });
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
  const PATH = [
    bin,
    path.dirname(process.execPath),
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
    // The separate Codex home of subc t3 builds before 8.2.0.
    legacyCodexHome: path.join(subc, 't3', 'codex', 'default'),
    claudeDir,
    claudeJson,
    claudeBin,
    claudeLauncher: path.join(subc, 'bin', 'subc-t3-claude'),
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
