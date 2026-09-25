// Standalone Windows hook, copied into the agent's user configuration.
// Observational only: never block a session, leak credentials, or print payloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

async function main() {
  const [client, configPath] = process.argv.slice(2);
  let payload = {};
  const input = await new Promise(resolve => {
    let text = '';
    const finish = () => { clearTimeout(timer); process.stdin.pause(); resolve(text); };
    const timer = setTimeout(finish, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { text += chunk; if (text.length > 4 * 1024 * 1024) finish(); });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
  try { payload = JSON.parse(input); } catch { /* fail open */ }
  const event = payload?.hook_event_name || '';
  const response = client === 'cursor'
    ? (event === 'preCompact' ? {} : { continue: true, permission: 'allow' })
    : client === 'copilot' ? { continue: true } : {};
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const cid = payload?.conversation_id || payload?.session_id;
    if (!cid || typeof cid !== 'string' || !config.apiKey || !config.gatewayUrl) return;
    const post = async body => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`${config.gatewayUrl}/v1/agent-hooks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, 'x-subconscious-client': client },
          body: JSON.stringify({ conversation_id: cid, hook_event_name: event, ...body }), signal: controller.signal,
        });
        await res.body?.cancel();
      } catch { /* fail open */ } finally { clearTimeout(timer); }
    };
    if ((client === 'cursor' && event === 'beforeSubmitPrompt') || (client === 'copilot' && event === 'UserPromptSubmit')) {
      if (typeof payload.prompt !== 'string' || !payload.prompt) return;
      const root = payload.workspace_roots?.[0] || payload.cwd;
      await post({ event: 'conversation_ensure', prompt: payload.prompt, workspace: typeof root === 'string' ? path.win32.basename(root) : undefined });
    }
    if (client === 'codex' && ['PreCompact', 'PostCompact'].includes(event)) {
      const phase = event === 'PreCompact' ? 'start' : 'end';
      await post({ event: 'conversation_compaction', phase, dedupe_key: `${cid}:${phase}:${payload.turn_id || randomUUID()}`, metadata: { trigger: payload.trigger, turn_id: payload.turn_id } });
    }
    if (client === 'cursor' && event === 'preCompact') {
      const metadata = Object.fromEntries(['trigger', 'context_tokens', 'context_window_size', 'context_usage_percent', 'message_count', 'messages_to_compact', 'is_first_compaction'].filter(k => payload[k] != null).map(k => [k, payload[k]]));
      await post({ event: 'conversation_compaction', phase: 'point', dedupe_key: `${cid}:${payload.generation_id ?? 'gen'}:${payload.is_first_compaction ?? false}`, metadata });
    }
    if (client === 'copilot' && ['PreCompact', 'UserPromptSubmit'].includes(event)) {
      const pendingDir = path.join(path.dirname(configPath), 'subconscious-compact-pending');
      const pending = path.join(pendingDir, createHash('sha256').update(cid).digest('hex') + '.json');
      if (event === 'PreCompact') {
        const token = randomUUID();
        await fs.mkdir(pendingDir, { recursive: true });
        await fs.writeFile(pending, JSON.stringify({ token }), { mode: 0o600 });
        await post({ event: 'conversation_compaction', phase: 'start', dedupe_key: `${cid}:start:${token}`, metadata: { trigger: payload.trigger || 'auto' } });
      } else {
        try {
          const { token } = JSON.parse(await fs.readFile(pending, 'utf8'));
          await fs.rm(pending, { force: true });
          await post({ event: 'conversation_compaction', phase: 'end', dedupe_key: `${cid}:end:${token}` });
        } catch { /* no pending compaction */ }
      }
    }
  } catch { /* missing/malformed config, I/O and transport errors are nonfatal */ }
  finally { process.stdout.write(JSON.stringify(response) + '\n'); }
}
main().catch(() => { process.stdout.write('{}\n'); }).finally(() => { process.exitCode = 0; });
