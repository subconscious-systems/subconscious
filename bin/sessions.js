import { spawnSync } from 'node:child_process';
import { spawnWindowsSync } from './windows/process.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { c } from './colors.js';
import { resolveAgent, runAgent } from './agents.js';

const MAX_CANDIDATE_FILES = 160;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_HANDOFF_MESSAGES = 24;
const MAX_HANDOFF_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 4_000;
const SESSION_KEY_PATTERN = /^(claude|codex|opencode|pi|sc):[-A-Za-z0-9._]+$/;

export const SESSION_HARNESSES = Object.freeze({
  claude: { name: 'Claude Code', command: 'claude', portable: true },
  codex: { name: 'Codex CLI', command: 'codex', portable: true },
  opencode: { name: 'OpenCode', command: 'opencode', portable: true },
  pi: { name: 'Pi', command: 'pi', portable: true },
  sc: { name: 'Marathon', command: 'marathon', portable: false },
});

function cleanText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function textFromContent(content) {
  if (typeof content === 'string') return cleanText(content);
  if (!Array.isArray(content)) return '';
  return cleanText(
    content
      .filter((part) => {
        if (typeof part === 'string') return true;
        return ['text', 'input_text', 'output_text'].includes(part?.type);
      })
      .map((part) => (typeof part === 'string' ? part : part.text || ''))
      .filter(Boolean)
      .join('\n'),
  );
}

function firstLine(value, fallback = 'Untitled session') {
  const line = cleanText(value).split('\n').find(Boolean) || fallback;
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}

function parseLines(text) {
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Session writers can leave a partial final line after an interrupted run.
    }
  }
  return records;
}

async function readBounded(file, limit = MAX_READ_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size <= limit) return handle.readFile({ encoding: 'utf8' });

    const half = Math.floor(limit / 2);
    const head = Buffer.alloc(half);
    const tail = Buffer.alloc(half);
    await handle.read(head, 0, half, 0);
    await handle.read(tail, 0, half, Math.max(0, stat.size - half));
    const headText = head.toString('utf8').replace(/[^\n]*$/, '');
    const tailText = tail.toString('utf8').replace(/^[^\n]*\n?/, '');
    return `${headText}\n${tailText}`;
  } finally {
    await handle.close();
  }
}

async function readHead(file, limit = 64 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return bytesRead === limit ? text.replace(/[^\n]*$/, '') : text;
  } finally {
    await handle.close();
  }
}

async function readTail(file, limit = MAX_INDEX_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    const text = buffer.toString('utf8');
    return stat.size > size ? text.replace(/^[^\n]*\n?/, '') : text;
  } finally {
    await handle.close();
  }
}

async function walkJsonl(root, maxDepth = 8) {
  const files = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length) {
    const { directory, depth } = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < maxDepth) {
        pending.push({ directory: resolved, depth: depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(resolved);
      }
    }
  }
  return files;
}

async function newestFiles(root, limit) {
  const files = await walkJsonl(root);
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const stat = await fs.stat(file);
        return { file, updated: stat.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return entries
    .filter(Boolean)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, Math.min(MAX_CANDIDATE_FILES, limit));
}

function sessionRecord(harness, id, values) {
  const descriptor = SESSION_HARNESSES[harness];
  if (!descriptor || !id) return null;
  const updatedMs =
    typeof values.updated === 'number'
      ? values.updated
      : Date.parse(values.updated || '') || 0;
  return {
    key: `${harness}:${id}`,
    id,
    harness,
    harnessName: descriptor.name,
    title: firstLine(values.title),
    cwd: values.cwd || '',
    updatedAt: new Date(updatedMs || Date.now()).toISOString(),
    updatedMs,
    model: values.model || '',
    sourcePath: values.sourcePath || '',
    portable: harness === 'opencode' || Boolean(values.sourcePath),
  };
}

function claudeMessages(records) {
  return records.flatMap((record) => {
    const role = record.message?.role || record.type;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.message?.content ?? record.content);
    return text ? [{ role, text }] : [];
  });
}

function codexMessages(records) {
  const responseItems = records.flatMap((record) => {
    if (record.type !== 'response_item') return [];
    const role = record.payload?.role;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.payload?.content);
    return text ? [{ role, text }] : [];
  });
  if (responseItems.length) return responseItems;

  return records.flatMap((record) => {
    if (record.type !== 'event_msg') return [];
    const eventType = record.payload?.type;
    const role = eventType === 'user_message' ? 'user' : eventType === 'agent_message' ? 'assistant' : '';
    const text = cleanText(record.payload?.message || record.payload?.last_agent_message);
    return role && text ? [{ role, text }] : [];
  });
}

function piMessages(records) {
  return records.flatMap((record) => {
    if (record.type !== 'message') return [];
    const role = record.message?.role;
    if (!['user', 'assistant'].includes(role)) return [];
    const text = textFromContent(record.message?.content);
    return text ? [{ role, text }] : [];
  });
}

function scMessages(records) {
  return records.flatMap((record) => {
    if (!['user', 'assistant'].includes(record.type)) return [];
    const text = cleanText(record.text ?? record.content);
    return text ? [{ role: record.type, text }] : [];
  });
}

async function parseFileSession(entry, harness) {
  const records = parseLines(await readBounded(entry.file, MAX_METADATA_BYTES));
  if (!records.length) return null;
  const filename = path.basename(entry.file, '.jsonl');

  if (harness === 'claude') {
    const messages = claudeMessages(records);
    const metadata = records.find((record) => record.cwd) || {};
    const identity = records.find((record) => record.sessionId) || {};
    const id = metadata.sessionId || identity.sessionId || filename.split('.orphaned-')[0];
    const titleRecord = records.find((record) => record.type === 'ai-title');
    const lastPrompt = [...records].reverse().find((record) => record.type === 'last-prompt');
    const assistant = records.find((record) => record.message?.role === 'assistant');
    return sessionRecord(harness, id, {
      title: titleRecord?.aiTitle || messages.find((message) => message.role === 'user')?.text || lastPrompt?.lastPrompt,
      cwd: metadata.cwd,
      model: assistant?.message?.model,
      updated: entry.updated,
      sourcePath: entry.file,
    });
  }

  if (harness === 'codex') {
    const meta = records.find((record) => record.type === 'session_meta')?.payload || {};
    const messages = codexMessages(records);
    const id = meta.id || filename.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)?.[1];
    const context = records.find((record) => record.type === 'turn_context')?.payload || {};
    return sessionRecord(harness, id, {
      title: messages.find((message) => message.role === 'user')?.text,
      cwd: meta.cwd,
      model: context.model,
      updated: entry.updated,
      sourcePath: entry.file,
    });
  }

  if (harness === 'pi') {
    const meta = records.find((record) => record.type === 'session') || {};
    const messages = piMessages(records);
    const assistant = records.find((record) => record.message?.role === 'assistant');
    return sessionRecord(harness, meta.id || filename.split('_').at(-1), {
      title: messages.find((message) => message.role === 'user')?.text,
      cwd: meta.cwd,
      model: assistant?.message?.model,
      updated: entry.updated,
      sourcePath: entry.file,
    });
  }

  if (harness === 'sc') {
    const meta = records[0] || {};
    const messages = scMessages(records);
    const id = String(meta.id || filename).replace(/^session-/, '');
    return sessionRecord(harness, id, {
      title: messages.find((message) => message.role === 'user')?.text,
      cwd: meta.cwd,
      model: meta.model,
      updated: entry.updated,
      sourcePath: entry.file,
    });
  }

  return null;
}

async function discoverFileSessions(root, harness, limit) {
  const files = await newestFiles(root, limit);
  const sessions = await Promise.all(
    files.map((entry) => parseFileSession(entry, harness).catch(() => null)),
  );
  return sessions.filter(Boolean);
}

function sessionIdFromFile(file, harness) {
  const name = path.basename(file, '.jsonl');
  if (harness === 'claude') {
    if (name.includes('.orphaned-') || file.split(path.sep).includes('subagents')) return '';
    return name;
  }
  if (harness === 'codex') {
    return name.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)?.[1] || '';
  }
  return '';
}

async function sourceFilesById(root, harness) {
  const files = await walkJsonl(root);
  return new Map(
    files
      .map((file) => [sessionIdFromFile(file, harness), file])
      .filter(([id]) => id),
  );
}

async function discoverClaudeIndex(root, indexFile, max) {
  let records;
  try {
    records = parseLines(await readTail(indexFile));
  } catch {
    return null;
  }
  const sources = await sourceFilesById(root, 'claude');
  const byID = new Map();
  for (const record of records) {
    if (!record.sessionId) continue;
    const updated = Number(record.timestamp) || 0;
    const current = byID.get(record.sessionId);
    if (!current || updated >= current.updated) {
      byID.set(record.sessionId, {
        id: record.sessionId,
        title: record.display,
        cwd: record.project,
        updated,
      });
    }
  }
  return [...byID.values()]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, max)
    .map((record) =>
      sessionRecord('claude', record.id, {
        ...record,
        sourcePath: sources.get(record.id),
      }),
    );
}

async function discoverCodexIndex(root, indexFile, max) {
  let records;
  try {
    records = parseLines(await readTail(indexFile));
  } catch {
    return null;
  }
  const sources = await sourceFilesById(root, 'codex');
  const byID = new Map();
  for (const record of records) {
    if (!record.id) continue;
    const updated = Date.parse(record.updated_at || '') || 0;
    const current = byID.get(record.id);
    if (!current || updated >= current.updated) {
      byID.set(record.id, { id: record.id, title: record.thread_name, updated });
    }
  }
  const selected = [...byID.values()].sort((a, b) => b.updated - a.updated).slice(0, max);
  return selected.map((record) =>
    sessionRecord('codex', record.id, {
      ...record,
      sourcePath: sources.get(record.id),
    }),
  );
}

function commandResult(execute, command, args, options = {}) {
  const result = execute(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 5_000,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function parseOpenCodeModel(value) {
  try {
    return JSON.parse(value || '{}').id || '';
  } catch {
    return '';
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function discoverOpenCodeSessions(execute, max) {
  const query = [
    'select id, title, directory, time_created, time_updated, model',
    'from session where time_archived is null',
    `order by time_updated desc limit ${Math.max(1, Math.min(500, max))}`,
  ].join(' ');
  const output = commandResult(execute, 'opencode', ['db', '--format', 'json', query]);
  if (!output) return [];
  try {
    return JSON.parse(output).map((record) =>
      sessionRecord('opencode', record.id, {
        title: record.title,
        cwd: record.directory,
        model: parseOpenCodeModel(record.model),
        updated: record.time_updated || record.time_created,
      }),
    );
  } catch {
    return [];
  }
}

export async function discoverSessions(options = {}) {
  const home = options.home || os.homedir();
  const max = options.max || 500;
  const execute = options.execute || (process.platform === 'win32' ? spawnWindowsSync : spawnSync);
  const roots = options.roots || {
    claude: path.join(home, '.claude', 'projects'),
    codex: path.join(home, '.codex', 'sessions'),
    pi: path.join(home, '.pi', 'agent', 'sessions'),
    sc: path.join(home, '.sc', 'sessions'),
  };
  const indexes =
    options.indexes ||
    (options.roots
      ? {
          claude: path.join(roots.claude, '.history-index.jsonl'),
          codex: path.join(roots.codex, '.session-index.jsonl'),
        }
      : {
          claude: path.join(home, '.claude', 'history.jsonl'),
          codex: path.join(home, '.codex', 'session_index.jsonl'),
        });
  const claude = await discoverClaudeIndex(roots.claude, indexes.claude, max);
  const codex = await discoverCodexIndex(roots.codex, indexes.codex, max);
  const groups = await Promise.all([
    claude || discoverFileSessions(roots.claude, 'claude', max),
    codex || discoverFileSessions(roots.codex, 'codex', max),
    Promise.resolve(discoverOpenCodeSessions(execute, max)),
    discoverFileSessions(roots.pi, 'pi', max),
    discoverFileSessions(roots.sc, 'sc', max),
  ]);
  const seen = new Set();
  return groups
    .flat()
    .filter((session) => {
      if (!session || seen.has(session.key)) return false;
      seen.add(session.key);
      return true;
    })
    .sort((a, b) => b.updatedMs - a.updatedMs)
    .slice(0, max);
}

async function openCodeMessages(session, execute) {
  const query = [
    "select json_extract(message.data, '$.role') as role,",
    "json_extract(part.data, '$.text') as text",
    'from message join part on part.message_id = message.id',
    `where message.session_id = ${sqlString(session.id)}`,
    "and json_extract(part.data, '$.type') = 'text'",
    'order by message.time_created asc, part.time_created asc',
  ].join(' ');
  const output = commandResult(execute, 'opencode', ['db', '--format', 'json', query]);
  if (!output) return [];
  try {
    return JSON.parse(output)
      .filter((row) => ['user', 'assistant'].includes(row.role) && cleanText(row.text))
      .map((row) => ({ role: row.role, text: cleanText(row.text) }));
  } catch {
    return [];
  }
}

export async function readSessionMessages(session, options = {}) {
  if (session.harness === 'opencode') {
    return openCodeMessages(session, options.execute || (process.platform === 'win32' ? spawnWindowsSync : spawnSync));
  }
  if (!session.sourcePath) return [];
  const records = parseLines(await readBounded(session.sourcePath));
  if (session.harness === 'claude') return claudeMessages(records);
  if (session.harness === 'codex') return codexMessages(records);
  if (session.harness === 'pi') return piMessages(records);
  if (session.harness === 'sc') return scMessages(records);
  return [];
}

async function hydrateSession(session) {
  if (session.harness !== 'codex' || !session.sourcePath || session.cwd) return session;
  try {
    const head = parseLines(await readHead(session.sourcePath));
    const meta = head.find((item) => item.type === 'session_meta')?.payload || {};
    const context = head.find((item) => item.type === 'turn_context')?.payload || {};
    return { ...session, cwd: meta.cwd || '', model: context.model || '' };
  } catch {
    return session;
  }
}

export function buildHandoffPrompt(session, messages) {
  const selected = [];
  let remaining = MAX_HANDOFF_CHARS;
  for (const message of messages.slice(-MAX_HANDOFF_MESSAGES).reverse()) {
    const label = message.role === 'assistant' ? 'Assistant' : 'User';
    const text = cleanText(message.text).slice(0, MAX_MESSAGE_CHARS);
    if (!text) continue;
    const block = `${label}:\n${text}`;
    if (block.length > remaining && selected.length) break;
    selected.push(block.slice(0, remaining));
    remaining -= block.length;
    if (remaining <= 0) break;
  }
  selected.reverse();
  if (!selected.length) {
    throw new Error(`No portable user/assistant messages were found in ${session.harnessName}.`);
  }

  return [
    `Continue the work from a session originally run in ${session.harnessName}.`,
    'This is a portable handoff, not native session state. Inspect the current working tree before changing files, preserve existing work, and use the transcript below only as context.',
    session.title ? `Session: ${session.title}` : '',
    session.cwd ? `Working directory: ${session.cwd}` : '',
    '',
    '<session_handoff>',
    ...selected,
    '</session_handoff>',
  ]
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n\n');
}

export function nativeResumeArgs(session) {
  if (session.harness === 'claude') return ['--resume', session.id];
  if (session.harness === 'codex') return ['resume', session.id];
  if (session.harness === 'opencode') return ['--session', session.id];
  if (session.harness === 'pi') return ['--session', session.sourcePath || session.id];
  if (session.harness === 'sc') return ['--resume', session.sourcePath];
  throw new Error(`Native resume is not supported for ${session.harnessName}.`);
}

export function handoffLaunchArgs(targetHarness, prompt) {
  if (targetHarness === 'opencode') return ['--prompt', prompt];
  if (['claude', 'codex', 'pi'].includes(targetHarness)) return [prompt];
  throw new Error(`${SESSION_HARNESSES[targetHarness]?.name || targetHarness} cannot start an interactive handoff yet.`);
}

function sessionByKey(sessions, key) {
  if (!SESSION_KEY_PATTERN.test(key || '')) throw new Error('Invalid session key.');
  return sessions.find((session) => session.key === key) || null;
}

function formatWhen(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString();
}

export function printSessions(sessions) {
  console.log(`\n  ${c.bold}Coding sessions${c.reset}\n`);
  if (!sessions.length) {
    console.log(`  ${c.dim}No supported local coding sessions were found.${c.reset}\n`);
    return;
  }
  for (const session of sessions) {
    console.log(`  ${c.cyan}${session.key}${c.reset}  ${c.bold}${session.title}${c.reset}`);
    console.log(
      `    ${c.dim}${session.harnessName} · ${formatWhen(session.updatedAt)}${session.cwd ? ` · ${session.cwd}` : ''}${c.reset}`,
    );
  }
  console.log(
    `\n  Resume with ${c.cyan}subc sessions resume <session-key>${c.reset} or add ${c.cyan}--harness codex${c.reset}.\n`,
  );
}

export async function sessionsCommand(argv, options = {}) {
  const sessions = options.sessions || (await discoverSessions(options));
  const action = argv[0];
  if (!action || action === 'list') {
    printSessions(sessions);
    return 0;
  }
  if (action !== 'resume') throw new Error(`Unknown sessions action: ${action}`);

  const key = argv[1];
  let session = sessionByKey(sessions, key);
  if (!session) throw new Error(`Session '${key}' was not found. Run subc sessions to refresh the list.`);
  session = await hydrateSession(session);
  const harnessIndex = argv.indexOf('--harness');
  const requestedHarness = harnessIndex >= 0 ? argv[harnessIndex + 1] : session.harness;
  const targetHarness = requestedHarness === 'marathon' ? 'sc' : requestedHarness;
  const target = SESSION_HARNESSES[targetHarness];
  if (!target) throw new Error(`Unknown destination harness: ${targetHarness}`);

  if (session.cwd) {
    try {
      const stat = await fs.stat(session.cwd);
      if (stat.isDirectory()) process.chdir(session.cwd);
    } catch {
      console.error(`  ${c.yellow}The original directory is unavailable; resuming in ${process.cwd()}.${c.reset}\n`);
    }
  }

  const agent = resolveAgent(target.command);
  if (!agent) throw new Error(`${target.name} is not registered with this CLI.`);
  if (targetHarness === session.harness) {
    console.log(`\n  ${c.dim}Resuming in ${c.reset}${c.bold}${session.harnessName}${c.reset}${c.dim}: ${session.title}${c.reset}\n`);
    return runAgent(agent, nativeResumeArgs(session), { profile: options.profile });
  }
  if (!target.portable) throw new Error(`${target.name} cannot receive cross-harness sessions yet.`);

  const messages = await readSessionMessages(session, options);
  const prompt = buildHandoffPrompt(session, messages);
  console.log(
    `\n  ${c.dim}Handing off ${c.reset}${c.bold}${session.harnessName}${c.reset}${c.dim} → ${c.reset}${c.bold}${target.name}${c.reset}${c.dim}: ${session.title}${c.reset}\n`,
  );
  return runAgent(agent, handoffLaunchArgs(targetHarness, prompt), { profile: options.profile });
}
