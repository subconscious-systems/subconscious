/**
 * Local development helper.
 *
 * Subconscious needs a public URL to call your self-hosted tools.
 * This script creates a Cloudflare Quick Tunnel automatically
 * (no signup, no config) and passes the URL to Next.js as APP_URL.
 *
 * If you don't need self-hosted tools, use `npm run dev:no-tunnel`.
 */

import { spawn } from "node:child_process";
import { Tunnel } from "cloudflared";

const PORT = process.env.PORT || 3000;

async function main() {
  let tunnelUrl = null;
  let tunnel = null;

  try {
    console.log("\n  Starting tunnel...\n");

    tunnel = Tunnel.quick({ "--url": `localhost:${PORT}` });

    tunnelUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Tunnel timed out after 15s")),
        15_000,
      );
      tunnel.once("url", (url) => {
        clearTimeout(timeout);
        resolve(url);
      });
      tunnel.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log(`  Tunnel ready`);
    console.log(`  ${tunnelUrl}\n`);
    console.log(
      "  Subconscious will call your self-hosted tools at this URL.\n",
    );
  } catch (err) {
    console.warn(`\n  Could not start tunnel: ${err.message}`);
    console.warn(
      "  Self-hosted tools (Calculator, WebReader) won't work.",
    );
    console.warn(
      "  Set APP_URL in .env.local to a public tunnel URL, or deploy to Vercel.\n",
    );
  }

  const env = { ...process.env };
  if (tunnelUrl) env.APP_URL = tunnelUrl;

  const next = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    stdio: "inherit",
    env,
  });

  function stopTunnel() {
    try {
      tunnel?._stop?.();
    } catch {
      // ignore
    }
  }

  function cleanup() {
    stopTunnel();
    next.kill("SIGTERM");
  }

  next.on("exit", (code) => {
    stopTunnel();
    process.exit(code ?? 0);
  });

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
