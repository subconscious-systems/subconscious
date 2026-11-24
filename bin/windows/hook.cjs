// Standalone Windows Copilot hook, copied into the user's Copilot configuration.
// Observational only: never block a session, leak credentials, or print payloads.
// It announces each prompt so the gateway can chain Copilot turns into one
// conversation. Other events are ignored.
const fs = require('node:fs/promises');
const path = require('node:path');

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
  const response = client === 'copilot' ? { continue: true } : {};
  try {
    if (client !== 'copilot' || event !== 'UserPromptSubmit') return;
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const cid = payload?.session_id;
    if (!cid || typeof cid !== 'string' || !config.apiKey || !config.gatewayUrl) return;
    if (typeof payload.prompt !== 'string' || !payload.prompt) return;
    const root = payload.cwd;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${config.gatewayUrl}/v1/agent-hooks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, 'x-subconscious-client': client },
        body: JSON.stringify({ event: 'conversation_ensure', conversation_id: cid, hook_event_name: event, prompt: payload.prompt, workspace: typeof root === 'string' ? path.win32.basename(root) : undefined }),
        signal: controller.signal,
      });
      await res.body?.cancel();
    } catch { /* fail open */ } finally { clearTimeout(timer); }
  } catch { /* missing/malformed config, I/O and transport errors are nonfatal */ }
  finally { process.stdout.write(JSON.stringify(response) + '\n'); }
}
main().catch(() => { process.stdout.write('{}\n'); }).finally(() => { process.exitCode = 0; });
