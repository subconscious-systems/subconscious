/**
 * `subc feedback` — send a message to the Subconscious support team.
 *
 * POSTs to the platform's /api/cli/feedback endpoint with the profile's API
 * key; the platform emails support@subconscious.dev and posts to Slack.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import readline from 'node:readline/promises';
import { c } from './colors.js';
import { getApiKey, getPlatformUrl } from './auth.js';
import { DEFAULT_PROFILE } from './profiles.js';
import { printLoginUpgradeWarning } from './upgrade.js';

export const FEEDBACK_API_PATH = '/api/cli/feedback';
export const SUPPORT_EMAIL = 'support@subconscious.dev';

/**
 * Parses feedback command arguments. Shared with tests.
 *
 *   -s, --subject <text>    One-line summary (default: "CLI feedback")
 *   -m, --message <text>    The message body (prompts when omitted on a TTY)
 */
export function parseFeedbackArgs(argv = []) {
  let subject = '';
  let message = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-s' || arg === '--subject') {
      subject = argv[++i] ?? '';
    } else if (arg.startsWith('--subject=')) {
      subject = arg.slice('--subject='.length);
    } else if (arg === '-m' || arg === '--message') {
      message = argv[++i] ?? '';
    } else if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length);
    } else if (arg !== '') {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { subject: subject.trim(), message: message.trim() };
}

/** Triage context sent alongside the message. Never includes the API key. */
export async function collectFeedbackContext(options = {}) {
  const pkgPath = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
  const platformUrl = getPlatformUrl(options.profile);
  return {
    'CLI version': pkg.version,
    Profile: options.profileName ?? DEFAULT_PROFILE,
    'Platform URL': platformUrl,
    'Gateway URL': options.profile?.values?.GATEWAY_URL?.trim() ?? '',
    Node: process.version,
    OS: `${os.platform()} ${os.release()}`,
  };
}

export function buildFeedbackPayload({ subject, message, context }) {
  return {
    subject: subject || 'CLI feedback',
    message,
    context: Object.fromEntries(
      Object.entries(context ?? {}).filter(([, value]) => Boolean(String(value).trim())),
    ),
  };
}

export async function submitFeedback(apiKey, platformUrl, payload, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${platformUrl.replace(/\/$/, '')}${FEEDBACK_API_PATH}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    },
  );
  return res;
}

async function promptForFeedback(argv) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const subject = argv.subject || (await rl.question(`\n  Subject (optional): `)).trim();
    let message = '';
    while (!message) {
      message = (await rl.question(`  Message: `)).trim();
      if (!message) console.log(`  ${c.dim}Message cannot be empty.${c.reset}`);
    }
    return { subject, message };
  } finally {
    rl.close();
  }
}

export async function feedbackCommand(argv = [], options = {}) {
  const parsed = parseFeedbackArgs(argv);
  const profileFlag =
    options.profileName && options.profileName !== DEFAULT_PROFILE
      ? `--profile ${options.profileName} `
      : '';

  const auth = await getApiKey(options.profile);
  if (!auth) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}`);
    console.log(`  Run ${c.cyan}subc ${profileFlag}login${c.reset} to get started.\n`);
    return;
  }

  let feedback = parsed;
  if (!feedback.message) {
    if (process.stdin.isTTY !== true) {
      console.error(`\n  ${c.red}A message is required.${c.reset}`);
      console.error(`  Pass one with ${c.cyan}subc feedback --message "..."${c.reset}\n`);
      process.exitCode = 1;
      return;
    }
    feedback = await promptForFeedback(parsed);
  }

  const platformUrl = getPlatformUrl(options.profile);
  const payload = buildFeedbackPayload({
    subject: feedback.subject,
    message: feedback.message,
    context: await collectFeedbackContext(options),
  });

  try {
    const res = await submitFeedback(auth.key, platformUrl, payload);

    if (res.status === 404) {
      printLoginUpgradeWarning();
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      const message = data?.error || `Request failed (${res.status})`;
      if (res.status === 401) {
        console.log(`\n  ${c.red}✗ ${message}${c.reset}`);
        console.log(
          `  Run ${c.cyan}subc ${profileFlag}logout${c.reset} then ${c.cyan}subc ${profileFlag}login${c.reset} to re-authenticate.\n`,
        );
        process.exitCode = 1;
        return;
      }
      throw new Error(message);
    }

    console.log(`\n  ${c.green}✓${c.reset} Feedback sent to ${SUPPORT_EMAIL}.`);
    console.log(`  ${c.dim}Our support team will get back to you.\n`);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.log(`\n  ${c.yellow}Could not reach the platform (timed out).${c.reset}`);
      console.log(`  ${c.dim}Host: ${platformUrl}${c.reset}\n`);
      process.exitCode = 1;
      return;
    }
    console.error(`\n  ${c.red}${error.message}${c.reset}\n`);
    process.exitCode = 1;
  }
}

export function printFeedbackHelp() {
  console.log(`
Usage:
  subc feedback
  subc feedback --subject "..." --message "..."
  subc -p NAME feedback
  subc feedback help

Send a message to the Subconscious support team (${SUPPORT_EMAIL}).
Your CLI version, profile, and environment are included so support can
triage without a back-and-forth.

  -s, --subject <text>   One-line summary (prompted when omitted on a TTY)
  -m, --message <text>   The message body (prompted when omitted on a TTY)
`);
}
