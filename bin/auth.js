/**
 * Authentication + credential storage for the Subconscious CLI.
 *
 * Login flow (device code):
 *  1. CLI asks the platform for a device code and a short user code.
 *  2. Opens {platformUrl}/cli/device?code=... in any browser.
 *  3. Polls the platform until the signed-in browser approves the code.
 *  4. Saves the key to ~/.subconscious/config.json and a runbook profile.
 *
 * Override SUBCONSCIOUS_URL env var for local development
 * (e.g. http://localhost:3000). Production defaults to platform.subconscious.dev.
 */

import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c } from './colors.js';
import {
  clearProfileApiKey,
  DEFAULT_PROFILE,
  ensureProfile,
} from './profiles.js';
import { printLoginUpgradeWarning } from './upgrade.js';
import { openWindowsBrowser } from './windows/process.js';

function configDir() {
  return (
    process.env.SUBC_CONFIG_DIR?.trim() ||
    path.join(os.homedir(), '.subconscious')
  );
}

function configFile() {
  return path.join(configDir(), 'config.json');
}

function legacyConfigFile() {
  if (process.env.SUBC_CONFIG_DIR?.trim()) return null;
  return path.join(os.homedir(), '.subcon', 'config.json');
}
// Defaults to the platform host. Developers set SUBCONSCIOUS_URL for local dev.
export const DEFAULT_PLATFORM_URL = 'https://platform.subconscious.dev';

export function getPlatformUrl(profile) {
  const fromEnv = process.env.SUBCONSCIOUS_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromProfile = profile?.values?.PLATFORM_URL?.trim();
  if (fromProfile) return fromProfile.replace(/\/$/, '');
  return DEFAULT_PLATFORM_URL;
}

async function loadConfig() {
  try {
    const content = await fs.readFile(configFile(), 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== 'ENOENT' || !legacyConfigFile()) return {};
  }

  try {
    const content = await fs.readFile(legacyConfigFile(), 'utf-8');
    const config = JSON.parse(content);
    await saveConfig(config);
    return config;
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2), 'utf-8');
  await fs.chmod(configFile(), 0o600);
}

export async function getApiKey(profile) {
  const envKey = process.env.SUBCONSCIOUS_API_KEY?.trim();
  if (envKey) return { key: envKey, source: 'SUBCONSCIOUS_API_KEY env var' };

  const profileKey = profile?.values?.API_KEY?.trim();
  if (profileKey) return { key: profileKey, source: profile.path };

  if (profile?.name && profile.name !== DEFAULT_PROFILE) return null;

  const config = await loadConfig();
  if (config.subconscious_api_key) {
    return {
      key: config.subconscious_api_key,
      source: '~/.subconscious/config.json',
    };
  }
  return null;
}

// ── Browser opener ──────────────────────────────────────────────────────

function openBrowser(url) {
  if (process.platform === 'win32') {
    void openWindowsBrowser(url)
      .then((code) => {
        if (code) throw new Error('Browser could not be opened');
      })
      .catch(() => console.log(`Please open this URL manually:\n\n  ${url}\n`));
    return;
  }
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

const DEVICE_POLL_INTERVAL_MS = 2000;
const DEVICE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function terminalLink(url) {
  return `\u001b]8;;${url}\u0007${url}\u001b]8;;\u0007`;
}

export async function registerDeviceLogin(platformUrl, fetchImpl = fetch) {
  const res = await fetchImpl(`${platformUrl}/api/cli/device/register`, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'Could not start CLI login.');
  }
  if (!data.device_code || !data.user_code) {
    throw new Error('CLI login response was missing a device code.');
  }
  return data;
}

export async function pollDeviceLogin(
  platformUrl,
  deviceCode,
  fetchImpl = fetch,
) {
  const res = await fetchImpl(`${platformUrl}/api/cli/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.key) return { status: 'approved', key: data.key };
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'expired') return { status: 'expired' };
  throw new Error(data.message || data.error || 'CLI login failed.');
}

function printDeviceInstructions(platformUrl, userCode) {
  const deviceUrl = `${platformUrl}/cli/device`;
  const verificationUrl = `${deviceUrl}?code=${encodeURIComponent(userCode)}`;
  console.log(`  ${c.dim}Opening browser to sign in...${c.reset}`);
  console.log();
  console.log(`  ${c.dim}If a window doesn't open, go to:${c.reset}`);
  console.log(
    `  ${c.underline}${c.cyan}${terminalLink(verificationUrl)}${c.reset}`,
  );
  console.log();
  console.log(
    `  ${c.dim}Or open ${c.reset}${c.underline}${c.cyan}${terminalLink(deviceUrl)}${c.reset}${c.dim} and enter:${c.reset} ${c.bold}${userCode}${c.reset}`,
  );
  console.log();
  return verificationUrl;
}

function printLoginFallback() {
  console.error(
    `  ${c.dim}You can also copy an API key from the dashboard and run${c.reset} ${c.cyan}subc update-key <your-api-key>${c.reset}${c.dim}.${c.reset}`,
  );
}

async function saveLoginKey(profileName, token) {
  if (profileName === DEFAULT_PROFILE) {
    const config = await loadConfig();
    config.subconscious_api_key = token;
    await saveConfig(config);
  }
  return ensureProfile(profileName, token);
}

export async function loginCommand(_argv = [], options = {}) {
  const profileName = options.profileName || DEFAULT_PROFILE;
  const existing = await getApiKey(options.profile);
  const fetchImpl = options.fetchImpl || fetch;

  if (existing) {
    const profile = await ensureProfile(profileName, existing.key);
    const logout =
      profileName === DEFAULT_PROFILE
        ? 'subc logout'
        : `subc --profile ${profileName} logout`;
    const masked = `${existing.key.slice(0, 8)}...${existing.key.slice(-4)}`;
    console.log(`\n${c.yellow}Already logged in.${c.reset}`);
    console.log(`  Key: ${c.dim}${masked}${c.reset}`);
    console.log(`  Profile: ${c.dim}${profile.path}${c.reset}`);
    console.log(
      `\n  Run ${c.cyan}${logout}${c.reset} first to switch accounts.\n`,
    );
    return;
  }

  console.log();
  console.log(
    `  ${c.magenta}${c.bold}Subconscious${c.reset} ${c.dim}— CLI Login${c.reset}`,
  );
  console.log();

  const platformUrl = getPlatformUrl(options.profile);
  let registered;
  try {
    registered = await registerDeviceLogin(platformUrl, fetchImpl);
  } catch (error) {
    console.error(`  ${c.red}✗ ${error.message}${c.reset}`);
    printLoginFallback();
    console.log();
    process.exitCode = 1;
    return;
  }

  const verificationUrl = printDeviceInstructions(
    platformUrl,
    registered.user_code,
  );
  (options.openBrowser || openBrowser)(verificationUrl);

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const spinner = setInterval(() => {
    process.stdout.write(
      `\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset} Waiting for authentication...`,
    );
  }, 80);

  const started = Date.now();
  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
  };
  process.on('SIGINT', onSigint);

  try {
    while (!cancelled) {
      if (Date.now() - started > DEVICE_POLL_TIMEOUT_MS) {
        throw new Error('Authentication timed out (5 min). Please try again.');
      }
      const polled = await pollDeviceLogin(
        platformUrl,
        registered.device_code,
        fetchImpl,
      );
      if (polled.status === 'approved') {
        clearInterval(spinner);
        process.stdout.write(`\r${' '.repeat(50)}\r`);
        const profile = await saveLoginKey(profileName, polled.key);
        const masked = `${polled.key.slice(0, 8)}...${polled.key.slice(-4)}`;
        console.log(`  ${c.green}${c.bold}✓ Logged in successfully!${c.reset}`);
        console.log(`  ${c.dim}Key: ${masked}${c.reset}`);
        if (profileName === DEFAULT_PROFILE) {
          console.log(
            `  ${c.dim}Saved to ~/.subconscious/config.json${c.reset}`,
          );
        }
        console.log(`  ${c.dim}Runbook profile: ${profile.path}${c.reset}`);
        console.log(
          `  ${c.dim}Launch a terminal agent with ${c.reset}${c.cyan}subc claude${c.reset}${c.dim}, or install editor hooks with ${c.reset}${c.cyan}subc cursor install${c.reset}${c.dim}.${c.reset}`,
        );
        console.log(
          `  ${c.dim}Pi needs ${c.reset}${c.cyan}subc pi install${c.reset}${c.dim} first. List profiles with ${c.reset}${c.cyan}subc config${c.reset}${c.dim}.${c.reset}`,
        );
        console.log();
        return;
      }
      if (polled.status === 'expired') {
        throw new Error('Login code expired. Please try again.');
      }
      await new Promise((resolve) =>
        setTimeout(resolve, DEVICE_POLL_INTERVAL_MS),
      );
    }
    clearInterval(spinner);
    process.stdout.write(`\r${' '.repeat(50)}\r`);
    console.log(`\n  ${c.dim}Login cancelled.${c.reset}\n`);
    process.exitCode = 1;
  } catch (error) {
    clearInterval(spinner);
    process.stdout.write(`\r${' '.repeat(50)}\r`);
    console.error(`  ${c.red}✗ ${error.message}${c.reset}`);
    printLoginFallback();
    console.log();
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

export async function updateApiKeyCommand(argv = [], options = {}) {
  if (argv.length !== 1 || !argv[0]?.trim()) {
    throw new Error('Usage: subc update-key <api-key>');
  }

  const key = argv[0].trim();
  const profileName = options.profileName || DEFAULT_PROFILE;
  const profile = await ensureProfile(profileName, key);

  if (profileName === DEFAULT_PROFILE) {
    const config = await loadConfig();
    config.subconscious_api_key = key;
    await saveConfig(config);
  }

  const masked =
    key.length <= 12 ? '********' : `${key.slice(0, 8)}...${key.slice(-4)}`;
  console.log(`\n  ${c.green}${c.bold}✓ API key updated.${c.reset}`);
  console.log(`  ${c.dim}Profile: ${profile.path}${c.reset}`);
  console.log(`  ${c.dim}Key:     ${masked}${c.reset}`);
  if (process.env.SUBCONSCIOUS_API_KEY?.trim()) {
    console.log(
      `\n  ${c.yellow}SUBCONSCIOUS_API_KEY is set and will override this saved key.${c.reset}`,
    );
  }
  console.log();
}

export async function logoutCommand(_argv = [], options = {}) {
  const profileName = options.profileName || DEFAULT_PROFILE;
  const config = await loadConfig();
  const clearedProfile = await clearProfileApiKey(profileName);
  const clearSavedConfig =
    profileName === DEFAULT_PROFILE && config.subconscious_api_key;

  if (!clearSavedConfig && !clearedProfile) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}\n`);
    return;
  }

  if (clearSavedConfig) {
    delete config.subconscious_api_key;
    await saveConfig(config);
  }

  console.log(
    `\n  ${c.green}✓${c.reset} Logged out of profile '${profileName}'.${c.reset}\n`,
  );
}

export async function whoamiCommand(_argv = [], options = {}) {
  const auth = await getApiKey(options.profile);
  const profileFlag =
    options.profileName && options.profileName !== DEFAULT_PROFILE
      ? `--profile ${options.profileName} `
      : '';

  if (!auth) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}`);
    console.log(
      `  Run ${c.cyan}subc ${profileFlag}login${c.reset} to get started.\n`,
    );
    return;
  }

  const { key, source } = auth;
  const masked = `${key.slice(0, 8)}...${key.slice(-4)}`;

  console.log();

  // Validate the key against the server; falls back to offline display if unreachable
  try {
    const res = await fetch(
      `${getPlatformUrl(options.profile)}/api/cli/whoami`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (res.status === 404) {
      printLoginUpgradeWarning();
      return;
    }

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
        `  Run ${c.cyan}subc ${profileFlag}logout${c.reset} then ${c.cyan}subc ${profileFlag}login${c.reset} to re-authenticate.`,
      );
    }
  } catch {
    console.log(
      `  ${c.green}✓ Authenticated${c.reset} ${c.dim}(offline — key not verified)${c.reset}`,
    );
    console.log(`  ${c.dim}Key:    ${masked}${c.reset}`);
    console.log(`  ${c.dim}Source: ${source}${c.reset}`);
  }

  console.log();
}
