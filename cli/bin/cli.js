#!/usr/bin/env node

/**
 * Subconscious CLI — `login`, `logout`, and `whoami` commands.
 *
 * Login flow (localhost callback pattern, similar to Vercel/Supabase CLIs):
 *  1. CLI generates a random `state` token (CSRF protection) and starts
 *     an ephemeral HTTP server on a random port bound to 127.0.0.1.
 *  2. Opens the browser to {PLATFORM_URL}/cli/auth?port=...&state=...
 *  3. The web app authenticates the user, generates an API key, and
 *     delivers it back to the CLI via a cross-origin fetch to
 *     localhost:{port}/callback?token=...&state=...
 *  4. CLI verifies the `state` matches, saves the key to ~/.subcon/config.json.
 *
 * Override SUBCONSCIOUS_URL env var for local development.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.subcon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// Defaults to production. Developers set SUBCONSCIOUS_URL=http://localhost:3000 for local dev.
const PLATFORM_URL = process.env.SUBCONSCIOUS_URL || 'https://www.subconscious.dev';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  underline: '\x1b[4m',
};

// ── Config helpers ──────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  // 0o600 = owner read/write only — the file contains an API key
  await fs.chmod(CONFIG_FILE, 0o600);
}

// ── Browser opener ──────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(
        `\n${c.yellow}Could not open browser automatically.${c.reset}`,
      );
      console.log(`Please open this URL manually:\n`);
      console.log(`  ${c.underline}${c.cyan}${url}${c.reset}\n`);
    }
  });
}

// ── Localhost callback server ───────────────────────────────────────────

function startCallbackServer(expectedState) {
  return new Promise((resolveSetup) => {
    let resolveToken, rejectToken;
    const tokenPromise = new Promise((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });

    const server = http.createServer((req, res) => {
      // CORS: only allow the web app's origin (production or localhost dev).
      // This prevents arbitrary websites from hitting this callback.
      const origin = req.headers.origin || '';
      const allowed =
        origin === PLATFORM_URL ||
        origin.startsWith('http://localhost:');
      res.setHeader(
        'Access-Control-Allow-Origin',
        allowed ? origin : PLATFORM_URL,
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Connection', 'close');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, 'http://localhost');

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      // The web app sends `Accept: application/json` via fetch(); direct
      // browser visits get the HTML fallback page.
      const wantsJson = (req.headers.accept || '').includes('application/json');
      const respond = (ok, msg) => {
        if (wantsJson) {
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok, error: msg || undefined }));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(resultPage(ok, msg));
        }
      };

      if (error) {
        respond(false, error);
        server.close();
        rejectToken(new Error(error));
        return;
      }

      // CSRF check: state token must match what the CLI generated
      if (state !== expectedState) {
        respond(false, 'State mismatch — possible CSRF attack. Please try again.');
        server.close();
        rejectToken(new Error('State mismatch'));
        return;
      }

      if (!token) {
        respond(false, 'No API key received.');
        server.close();
        rejectToken(new Error('No API key received'));
        return;
      }

      respond(true);
      server.close();
      resolveToken({ token });
    });

    // Port 0 = OS assigns a random available port. Bound to 127.0.0.1 only.
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;

      const timeout = setTimeout(() => {
        server.close();
        rejectToken(new Error('Authentication timed out (5 min). Please try again.'));
      }, 5 * 60 * 1000);

      tokenPromise.finally(() => clearTimeout(timeout));

      resolveSetup({ port, promise: tokenPromise });
    });
  });
}

function resultPage(success, message) {
  const title = success ? 'Authenticated' : 'Authentication failed';
  const subtitle = success
    ? 'You can close this tab and return to your terminal.'
    : message || 'Something went wrong.';

  const logoSvg = `<svg viewBox="0 0 205 199" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M-4.33e-06 99.93C-4.96e-06 85.57 11.64 73.93 26 73.93c7.88 0 14.94 3.51 19.71 9.04 5.25 6.09 11.36 12.6 19.37 13.33l3.92.36v-.01c.03.01.06.01.09.01L72 96.93c12.69 0 23.98-10.28 24-22.96-.01-7.36-3.48-13.91-8.87-18.11l-1.08-.76c-6.52-4.6-15.3-3.65-23.19-2.46-7.28 1.1-14.97-.88-20.96-6.08C31.06 37.13 29.91 20.71 39.33 9.87 48.75-.96 65.18-2.11 76.01 7.31c5.99 5.21 9.02 12.55 8.94 19.91-.09 7.97.2 16.8 5.66 22.62l.94 1 .11.1.14.12c.22.19.45.37.68.55l.17.13c.25.18.5.36.75.53.64.42 1.31.8 2.01 1.14.48.23.98.44 1.49.62.21.07.42.14.63.21.32.1.64.19.97.27.4.1.8.18 1.2.25.34.06.69.11 1.03.14.58.06 1.17.09 1.77.09 4.2 0 8.03-1.57 10.95-4.16l.94-1c5.46-5.81 5.75-14.65 5.66-22.62-.08-7.36 2.95-14.71 8.94-19.91C139.82-2.11 156.25-.96 165.67 9.87c9.42 10.84 8.27 27.26-2.56 36.68-5.99 5.21-13.69 7.18-20.96 6.08-7.88-1.19-16.67-2.14-23.19 2.46l-1.08.76c-5.39 4.2-8.86 10.75-8.87 18.11.02 12.69 11.31 22.96 24 22.96l2.91-.26.09-.02v.01l3.93-.36c8.01-.73 14.12-7.23 19.37-13.33 4.77-5.54 11.83-9.04 19.71-9.04C193.36 73.93 205 85.57 205 99.93v.07c0 .01 0 .02 0 .03 0 14.36-11.64 26-26 26-7.88 0-14.94-3.51-19.71-9.04-5.25-6.09-11.36-12.6-19.37-13.33l-3.93-.36v.01c-.03-.01-.06-.01-.09-.01L133 103c-12.69 0-23.98 10.28-24 22.97.01 7.36 3.48 13.91 8.87 18.11l1.08.76c6.52 4.6 15.3 3.65 23.19 2.46 7.28-1.1 14.97.88 20.96 6.08 10.84 9.42 11.98 25.84 2.56 36.68-9.42 10.84-25.84 11.98-36.68 2.56-5.99-5.21-9.02-12.55-8.94-19.91.09-7.97-.2-16.8-5.66-22.62l-.94-1c-2.91-2.59-6.75-4.16-10.95-4.16-.6 0-1.19.03-1.77.09-.35.04-.69.09-1.03.14-.34.07-.69.15-1.03.25-.33.08-.65.17-.97.28-.21.07-.42.14-.62.21-.51.18-1.01.39-1.49.62-.7.33-1.37.71-2.01 1.14-.26.17-.5.35-.75.53l-.17.13a11 11 0 0 0-.68.55l-.14.12-.11.1-.94 1.01c-5.46 5.81-5.75 14.65-5.66 22.62.08 7.36-2.95 14.71-8.94 19.91-10.84 9.42-27.26 8.27-36.68-2.56-9.42-10.84-8.27-27.26 2.56-36.68 5.99-5.21 13.69-7.18 20.96-6.08 7.88 1.19 16.67 2.14 23.19-2.46l1.08-.76c5.39-4.2 8.86-10.75 8.87-18.11-.02-12.69-11.31-22.97-24-22.97l-2.91.27c-.03 0-.06.01-.09.01v-.01l-3.93.36c-8.01.73-14.12 7.23-19.37 13.33C40.94 122.49 33.88 126 26 126 11.64 126 0 114.36 0 100l-4.33e-06-.07Z" fill="#FF5C28"/></svg>`;

  const statusIcon = success
    ? `<div class="icon success"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`
    : `<div class="icon error"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>`;

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Subconscious CLI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Manrope',system-ui,sans-serif;min-height:100vh;background:#F6F3EF;color:#111}
header{display:flex;align-items:center;gap:10px;padding:20px 24px}
header svg{width:24px;height:24px}
header span{font-size:15px;font-weight:600;letter-spacing:-.01em}
main{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 160px)}
.wrap{width:100%;max-width:400px;padding:0 24px}
.label{text-align:center;font-size:11px;font-weight:500;text-transform:uppercase;
  letter-spacing:.1em;color:#9ca3af;margin-bottom:16px}
.card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px;
  padding:32px;text-align:center}
.icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;margin:0 auto 16px}
.icon.success{background:#f0fdf4}
.icon.error{background:#fef2f2}
h1{font-size:15px;font-weight:600;margin-bottom:4px;letter-spacing:-.01em}
.sub{color:#6b7280;font-size:13px;line-height:1.6;max-width:280px;margin:0 auto}
.footer{text-align:center;margin-top:16px;font-size:11px;color:#9ca3af}
</style></head><body>
<header>${logoSvg}<span>Subconscious</span></header>
<main><div class="wrap">
  <div class="label">CLI Authentication</div>
  <div class="card">
    ${statusIcon}
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
  </div>
  <div class="footer">subconscious.dev</div>
</div></main>
</body></html>`;
}

// ── Commands ────────────────────────────────────────────────────────────

async function loginCommand() {
  // Environment variable takes precedence over config file
  const existingConfig = await loadConfig();
  const existingKey =
    process.env.SUBCONSCIOUS_API_KEY || existingConfig.subconscious_api_key;

  if (existingKey) {
    const masked = existingKey.slice(0, 8) + '...' + existingKey.slice(-4);
    console.log(`\n${c.yellow}Already logged in.${c.reset}`);
    console.log(`  Key: ${c.dim}${masked}${c.reset}`);
    console.log(
      `\n  Run ${c.cyan}subconscious logout${c.reset} first to switch accounts.\n`,
    );
    return;
  }

  console.log();
  console.log(
    `  ${c.magenta}${c.bold}Subconscious${c.reset} ${c.dim}— CLI Login${c.reset}`,
  );
  console.log();

  const state = crypto.randomBytes(16).toString('hex');
  const { port, promise } = await startCallbackServer(state);

  const authUrl = `${PLATFORM_URL}/cli/auth?port=${port}&state=${state}`;

  console.log(`  ${c.dim}Opening browser to sign in...${c.reset}`);
  console.log();
  console.log(`  ${c.dim}If it doesn't open, visit:${c.reset}`);
  console.log(`  ${c.underline}${c.cyan}${authUrl}${c.reset}`);
  console.log();

  openBrowser(authUrl);

  // Spinner while waiting
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const spinner = setInterval(() => {
    process.stdout.write(
      `\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset} Waiting for authentication...`,
    );
  }, 80);

  process.on('SIGINT', () => {
    clearInterval(spinner);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
    console.log(`\n  ${c.dim}Login cancelled.${c.reset}\n`);
    process.exit(0);
  });
  try {
    const result = await promise;
    clearInterval(spinner);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    const config = await loadConfig();
    config.subconscious_api_key = result.token;
    await saveConfig(config);

    const masked = result.token.slice(0, 8) + '...' + result.token.slice(-4);
    console.log(`  ${c.green}${c.bold}✓ Logged in successfully!${c.reset}`);
    console.log(`  ${c.dim}Key: ${masked}${c.reset}`);
    console.log(`  ${c.dim}Saved to ~/.subcon/config.json${c.reset}`);
    console.log();
  } catch (error) {
    clearInterval(spinner);
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
    console.error(`  ${c.red}✗ ${error.message}${c.reset}\n`);
    process.exit(1);
  }
}

async function logoutCommand() {
  const config = await loadConfig();

  if (!config.subconscious_api_key) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}\n`);
    return;
  }

  delete config.subconscious_api_key;
  await saveConfig(config);

  console.log(
    `\n  ${c.green}✓${c.reset} Logged out. API key removed from ${c.dim}~/.subcon/config.json${c.reset}\n`,
  );
}

async function whoamiCommand() {
  const config = await loadConfig();
  const envKey = process.env.SUBCONSCIOUS_API_KEY;
  const savedKey = config.subconscious_api_key;
  const key = envKey || savedKey;

  if (!key) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}`);
    console.log(
      `  Run ${c.cyan}subconscious login${c.reset} to get started.\n`,
    );
    return;
  }

  const masked = key.slice(0, 8) + '...' + key.slice(-4);
  const source = envKey
    ? 'SUBCONSCIOUS_API_KEY env var'
    : '~/.subcon/config.json';

  console.log();

  // Validate the key against the server; falls back to offline display if unreachable
  try {
    const res = await fetch(`${PLATFORM_URL}/api/cli/whoami`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`  ${c.green}✓ Authenticated${c.reset}`);
      if (data.organization) {
        console.log(`  ${c.dim}Org:    ${c.reset}${data.organization}`);
      }
      console.log(`  ${c.dim}Key:    ${masked}${c.reset}`);
      console.log(`  ${c.dim}Source: ${source}${c.reset}`);
    } else {
      console.log(`  ${c.red}✗ Key is invalid or revoked${c.reset}`);
      console.log(`  ${c.dim}Key:    ${masked}${c.reset}`);
      console.log(`  ${c.dim}Source: ${source}${c.reset}`);
      console.log();
      console.log(
        `  Run ${c.cyan}subconscious logout${c.reset} then ${c.cyan}subconscious login${c.reset} to re-authenticate.`,
      );
    }
  } catch {
    console.log(`  ${c.green}✓ Authenticated${c.reset} ${c.dim}(offline — key not verified)${c.reset}`);
    console.log(`  ${c.dim}Key:    ${masked}${c.reset}`);
    console.log(`  ${c.dim}Source: ${source}${c.reset}`);
  }

  console.log();
}

// ── Help & entry ────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  ${c.magenta}${c.bold}Subconscious CLI${c.reset}

  ${c.bold}Usage${c.reset}
    ${c.cyan}subconscious${c.reset} <command>

  ${c.bold}Commands${c.reset}
    ${c.cyan}login${c.reset}     Authenticate and save your API key
    ${c.cyan}logout${c.reset}    Remove saved credentials
    ${c.cyan}whoami${c.reset}    Show current authentication status

  ${c.bold}Options${c.reset}
    ${c.dim}-h, --help${c.reset}     Show this help
    ${c.dim}-v, --version${c.reset}  Show version

  ${c.bold}Quick start${c.reset}
    ${c.dim}$${c.reset} npx @subconscious/cli login
`);
}

const commands = { login: loginCommand, logout: logoutCommand, whoami: whoamiCommand };

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    console.log(pkg.version);
    return;
  }

  const handler = commands[command];
  if (!handler) {
    console.error(`\n  ${c.red}Unknown command: ${command}${c.reset}`);
    printHelp();
    process.exit(1);
  }

  await handler(args.slice(1));
}

main().catch((error) => {
  console.error(`${c.red}${error.message}${c.reset}`);
  process.exit(1);
});
