import localtunnel from "localtunnel";
import { verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Tunnel Support
 *
 * Handles tunnel setup for exposing local HTTP server to Subconscious.
 * Uses localtunnel (npm package) - no external dependencies required.
 */

export interface TunnelConfig {
  enabled: boolean;
  autoStart: boolean;
  port: number;
}

export interface TunnelResult {
  url: string;
  tunnel?: localtunnel.Tunnel;
  autoStarted: boolean;
}

/**
 * Get tunnel URL from environment or start a new one.
 */
export async function setupTunnel(
  localUrl: string,
  config: TunnelConfig
): Promise<TunnelResult> {
  // Check for existing tunnel URL in environment
  const existingTunnelUrl = process.env.TUNNEL_URL;
  if (existingTunnelUrl) {
    log(`[tunnel] Using existing tunnel URL: ${existingTunnelUrl}`);
    return { url: existingTunnelUrl, autoStarted: false };
  }

  // If tunnel is not enabled, return local URL (won't work but user will see error)
  if (!config.enabled) {
    console.warn(
      "[tunnel] Tunnel not enabled. Subconscious won't be able to reach local server."
    );
    console.warn(
      "[tunnel] Set TUNNEL_URL environment variable or enable auto-start in config."
    );
    return { url: localUrl, autoStarted: false };
  }

  // Auto-start tunnel if configured
  if (config.autoStart) {
    return startLocaltunnel(config.port);
  }

  log("\n[tunnel] Tunnel required for Subconscious to reach local server.");
  log("[tunnel] Set TUNNEL_URL environment variable with the tunnel URL.\n");

  throw new Error(
    "Tunnel required but not started. Set TUNNEL_URL or enable auto-start in config."
  );
}

/**
 * Start localtunnel (npm package - no external dependencies required).
 */
async function startLocaltunnel(port: number): Promise<TunnelResult> {
  log("[tunnel] Starting localtunnel...");

  try {
    const tunnel = await localtunnel({ port });

    log(`[tunnel] ✓ Tunnel ready: ${tunnel.url}`);

    tunnel.on("error", (err) => {
      console.error(`[tunnel] localtunnel error: ${err.message}`);
    });

    tunnel.on("close", () => {
      log("[tunnel] localtunnel closed");
    });

    return {
      url: tunnel.url,
      tunnel,
      autoStarted: true,
    };
  } catch (error: any) {
    console.error("\n[tunnel] ❌ Could not start tunnel.");
    console.error("[tunnel] Error:", error.message);
    console.error("\n[tunnel] Options:");
    console.error("  1. Check your network connection");
    console.error(
      "  2. Set TUNNEL_URL environment variable to use an existing tunnel\n"
    );
    throw new Error(`Failed to start localtunnel: ${error.message}`);
  }
}

/**
 * Stop the tunnel.
 */
export function stopTunnel(result?: TunnelResult): void {
  if (result?.tunnel) {
    result.tunnel.close();
    log("[tunnel] Tunnel stopped");
  }
}
