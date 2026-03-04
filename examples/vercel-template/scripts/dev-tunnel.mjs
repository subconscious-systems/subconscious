/**
 * Local development helper.
 *
 * Subconscious needs a public URL to call your self-hosted tools.
 * This script creates a localtunnel with auto-reconnect and a
 * periodic health check so the tunnel stays alive.
 *
 * If you don't need self-hosted tools, use `npm run dev:no-tunnel`.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import localtunnel from "localtunnel";

const PREFERRED_PORT = Number(process.env.PORT || 3000);
const HEALTH_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;

let tunnel = null;
let tunnelUrl = null;
let nextProcess = null;
let activePort = null;

async function findOpenPort(start) {
  for (let port = start; port < start + 20; port++) {
    const available = await new Promise((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, () => {
        srv.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error(`No open port found in range ${start}–${start + 19}`);
}

async function openTunnel() {
  tunnel = await localtunnel({ port: activePort });
  tunnelUrl = tunnel.url;

  tunnel.on("close", () => {
    console.log("\n  ⚠ Tunnel closed — reconnecting...\n");
    setTimeout(reconnect, RECONNECT_DELAY_MS);
  });

  tunnel.on("error", (err) => {
    console.log(`\n  ⚠ Tunnel error: ${err.message} — reconnecting...\n`);
    try { tunnel.close(); } catch { /* ignore */ }
    setTimeout(reconnect, RECONNECT_DELAY_MS);
  });

  return tunnelUrl;
}

async function reconnect() {
  try {
    const url = await openTunnel();
    console.log(`  Tunnel reconnected`);
    console.log(`  ${url}\n`);
  } catch (err) {
    console.warn(`  Reconnect failed: ${err.message} — retrying in ${RECONNECT_DELAY_MS / 1000}s`);
    setTimeout(reconnect, RECONNECT_DELAY_MS);
  }
}

async function healthCheck() {
  if (!tunnel || tunnel.closed) return;
  try {
    const res = await fetch(tunnelUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
      headers: { "Bypass-Tunnel-Reminder": "true" },
    });
    if (!res.ok && res.status !== 404) {
      console.log(`\n  ⚠ Health check failed (${res.status}) — reconnecting...\n`);
      try { tunnel.close(); } catch { /* ignore */ }
    }
  } catch {
    console.log("\n  ⚠ Health check failed (unreachable) — reconnecting...\n");
    try { tunnel.close(); } catch { /* ignore */ }
  }
}

async function main() {
  activePort = await findOpenPort(PREFERRED_PORT);
  if (activePort !== PREFERRED_PORT) {
    console.log(`\n  Port ${PREFERRED_PORT} is in use, using ${activePort} instead.\n`);
  }

  try {
    console.log("\n  Starting tunnel...\n");
    const url = await openTunnel();
    console.log(`  Tunnel ready`);
    console.log(`  ${url}\n`);
    console.log(
      "  Subconscious will call your self-hosted tools at this URL.\n",
    );
  } catch (err) {
    console.warn(`\n  Could not start tunnel: ${err.message}`);
    console.warn("  Self-hosted tools (Calculator, WebReader) won't work.");
    console.warn(
      "  Set APP_URL in .env.local to a public tunnel URL, or deploy to Vercel.\n",
    );
  }

  const healthTimer = setInterval(healthCheck, HEALTH_INTERVAL_MS);

  const env = { ...process.env };
  if (tunnelUrl) env.APP_URL = tunnelUrl;

  nextProcess = spawn(
    "npx",
    ["next", "dev", "--port", String(activePort)],
    { stdio: "inherit", env },
  );

  function cleanup() {
    clearInterval(healthTimer);
    try { tunnel?.close(); } catch { /* ignore */ }
    nextProcess.kill("SIGTERM");
  }

  nextProcess.on("exit", (code) => {
    clearInterval(healthTimer);
    try { tunnel?.close(); } catch { /* ignore */ }
    process.exit(code ?? 0);
  });

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
