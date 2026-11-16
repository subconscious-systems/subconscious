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
export async function t3Sandbox({ gateway, apiKey = GOOD_KEY, settings } = {}) {
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
    codexHome: path.join(subc, 't3', 'codex', 'default'),
    catalogDir: path.join(subc, 't3', 'codex', 'catalog'),
    state: path.join(subc, 't3', 'state.json'),
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
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

/** Run a command; resolves with code, signal, stdout, and stderr. */
export function run(file, args, { env, input, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
      resolve({ code, signal, stdout, stderr });
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
