// Windows-only Pi extension. Loaded config is relative to this installed file.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export default function (pi: { on: (event: string, handler: (...args: any[]) => any) => void }) {
  for (const [eventName, phase] of [['session_before_compact', 'start'], ['session_compact', 'end']]) {
    pi.on(eventName, async (event: any, ctx: any) => {
      const session = ctx?.sessionManager?.getSessionId?.();
      if (!session) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'subconscious-windows.json'), 'utf8'));
        const url = process.env.SUBCONSCIOUS_GATEWAY_URL || config.gatewayUrl;
        const key = process.env.SUBCONSCIOUS_API_KEY || config.apiKey;
        if (!url || !key) return;
        const response = await fetch(`${url.replace(/\/+$/, '')}/v1/agent-hooks`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-subconscious-client': 'pi' },
          body: JSON.stringify({ event: 'conversation_compaction', conversation_id: session, phase, hook_event_name: eventName, dedupe_key: `${session}:${phase}:${randomUUID()}`, metadata: { reason: event?.reason, tokens_before: event?.preparation?.tokensBefore, from_extension: event?.fromExtension } }),
          signal: controller.signal,
        });
        await response.body?.cancel();
      } catch { /* observational: never cancel or replace compaction */ }
      finally { clearTimeout(timer); }
    });
  }
}
