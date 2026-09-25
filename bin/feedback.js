/**
 * `subc feedback` — send a message to the Subconscious support team.
 *
 * POSTs to the platform's /api/cli/feedback endpoint with the profile's API
 * key; the platform emails support@subconscious.dev and posts to Slack.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { c } from './colors.js';
import { getApiKey, getPlatformUrl } from './auth.js';
import { imageContentType, readClipboardImage } from './clipboard-image.js';
import { DEFAULT_PROFILE } from './profiles.js';

export const FEEDBACK_API_PATH = '/api/cli/feedback';
export const SUPPORT_EMAIL = 'support@subconscious.dev';

/**
 * Parses feedback command arguments. Shared with tests.
 *
 *   -s, --subject <text>    One-line summary (default: "CLI feedback")
 *   -m, --message <text>    The message body (prompts when omitted on a TTY)
 *   --image <path>          JPEG or PNG to attach (repeatable)
 */
export function parseFeedbackArgs(argv = []) {
  let subject = '';
  let message = '';
  const images = [];
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
    } else if (arg === '--image') {
      images.push(argv[++i] ?? '');
    } else if (arg.startsWith('--image=')) {
      images.push(arg.slice('--image='.length));
    } else if (arg !== '') {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { subject: subject.trim(), message: message.trim(), images };
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

export function buildFeedbackPayload({ subject, message, context, attachments }) {
  const payload = {
    subject: subject || 'CLI feedback',
    message,
    context: Object.fromEntries(
      Object.entries(context ?? {}).filter(([, value]) => Boolean(String(value).trim())),
    ),
  };
  if (attachments?.length) payload.attachments = attachments;
  return payload;
}

export async function loadFeedbackImages(paths) {
  const attachments = [];
  for (const filePath of paths) {
    if (!filePath?.trim()) throw new Error('An image path is required after --image');
    const buffer = await fs.readFile(filePath);
    const contentType = imageContentType(buffer);
    if (!contentType) throw new Error(`${filePath} is not a JPEG or PNG`);
    attachments.push({ contentType, data: buffer.toString('base64') });
  }
  return attachments;
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
      signal: AbortSignal.timeout(payload.attachments?.length ? 30000 : 8000),
    },
  );
  return res;
}

const MAX_FEEDBACK_IMAGES = 3;

function readAttachmentLine(onPaste) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '  Attachments: ',
    });
    readline.emitKeypressEvents(process.stdin, rl);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    rl.prompt();
    let line = '';
    const finish = (value) => {
      process.stdin.off('keypress', onKey);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
      resolve(value);
    };
    const onKey = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        finish(null);
        return;
      }
      if (key.ctrl && key.name === 'v') {
        void onPaste();
        return;
      }
      if (key.name === 'return') {
        process.stdout.write('\n');
        if (line.trim()) {
          console.log(
            `  ${c.dim}Paste a screenshot with Ctrl+V. Press Enter with nothing typed to continue.${c.reset}`,
          );
          line = '';
          rl.prompt();
          return;
        }
        finish('');
        return;
      }
      if (key.name === 'backspace') {
        if (!line.length) return;
        line = line.slice(0, -1);
        process.stdout.write('\b \b');
        return;
      }
      if (str && !key.ctrl && !key.meta) {
        line += str;
        process.stdout.write(str);
      }
    };
    process.stdin.on('keypress', onKey);
  });
}

async function promptForAttachments(already = 0) {
  if (process.stdin.isTTY !== true || already >= MAX_FEEDBACK_IMAGES) return [];
  const attachments = [];
  console.log(`\n  Attachments (optional). Ctrl+V pastes a screenshot from the clipboard.`);
  console.log(`  ${c.dim}Press Enter when you are done.${c.reset}`);
  while (already + attachments.length < MAX_FEEDBACK_IMAGES) {
    const line = await readAttachmentLine(async () => {
      if (already + attachments.length >= MAX_FEEDBACK_IMAGES) return;
      const buffer = await readClipboardImage();
      const contentType = buffer ? imageContentType(buffer) : null;
      if (!contentType || !buffer) {
        console.log(`\n  ${c.yellow}No JPEG or PNG image on the clipboard.${c.reset}`);
        return;
      }
      attachments.push({ contentType, data: buffer.toString('base64') });
      console.log(`  ${c.green}Added screenshot ${already + attachments.length}.${c.reset}`);
    });
    if (line == null || !line.trim()) break;
  }
  return attachments;
}

async function promptForFeedback(argv) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
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

  const fromFlags = await loadFeedbackImages(parsed.images);
  const fromPrompt = feedback.message && parsed.message ? [] : await promptForAttachments(fromFlags.length);
  const platformUrl = getPlatformUrl(options.profile);
  const payload = buildFeedbackPayload({
    subject: feedback.subject,
    message: feedback.message,
    context: await collectFeedbackContext(options),
    attachments: [...fromFlags, ...fromPrompt],
  });

  try {
    const res = await submitFeedback(auth.key, platformUrl, payload);

    if (res.status === 404) {
      console.error(`\n  ${c.yellow}This platform has no feedback endpoint (404).${c.reset}`);
      console.error(`  ${c.dim}Host: ${platformUrl}${c.reset}`);
      console.error(`  ${c.dim}Point PLATFORM_URL at a platform that includes /api/cli/feedback.${c.reset}\n`);
      process.exitCode = 1;
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      const detail = typeof data?.error === 'string' ? data.error : '';
      const invalidKey = detail === 'Invalid or revoked API key' || detail === 'No API key provided';
      console.log(`\n  ${c.red}✗ Couldn't send your message.${c.reset}`);
      if (invalidKey) {
        console.log(
          `  Run ${c.cyan}subc ${profileFlag}logout${c.reset} then ${c.cyan}subc ${profileFlag}login${c.reset} to re-authenticate.`,
        );
      }
      console.log(`  Please email ${c.cyan}${SUPPORT_EMAIL}${c.reset} directly.\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n  ${c.green}✓${c.reset} Feedback sent to ${SUPPORT_EMAIL}.`);
    console.log(`  ${c.dim}Our support team will get back to you.\n`);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.log(`\n  ${c.yellow}Could not reach the platform (timed out).${c.reset}`);
      console.log(`  ${c.dim}Host: ${platformUrl}${c.reset}`);
    } else {
      console.log(`\n  ${c.red}✗ Couldn't send your message.${c.reset}`);
    }
    console.log(`  Please email ${c.cyan}${SUPPORT_EMAIL}${c.reset} directly.\n`);
    process.exitCode = 1;
  }
}

export function printFeedbackHelp() {
  console.log(`
Usage:
  subc feedback
  subc feedback --subject "..." --message "..."
  subc feedback --image ./screenshot.png
  subc -p NAME feedback
  subc feedback help

Send a message to the Subconscious support team (${SUPPORT_EMAIL}).
Your CLI version, profile, and environment are included so support can
triage without a back-and-forth.

  -s, --subject <text>   One-line summary (prompted when omitted on a TTY)
  -m, --message <text>   The message body (prompted when omitted on a TTY)
  --image <path>         JPEG or PNG to attach (repeatable). With -m, skips the paste prompt.
`);
}
