import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";
import { verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Cloudflare Tunnel Support
 * 
 * Handles tunnel setup for exposing local HTTP server to Subconscious.
 * Supports:
 * - Using existing tunnel URL from env var
 * - Auto-starting cloudflared tunnel
 * - Manual tunnel setup instructions
 */

export interface TunnelConfig {
  enabled: boolean;
  autoStart: boolean;
  port: number;
  cloudflaredPath?: string;
}

export interface TunnelResult {
  url: string;
  process?: ChildProcess;
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
    return {
      url: existingTunnelUrl,
      autoStarted: false,
    };
  }

  // If tunnel is not enabled, return local URL (won't work but user will see error)
  if (!config.enabled) {
    console.warn(
      "[tunnel] Tunnel not enabled. Subconscious won't be able to reach local server."
    );
    console.warn(
      "[tunnel] Set TUNNEL_URL environment variable or enable auto-start in config."
    );
    return {
      url: localUrl,
      autoStarted: false,
    };
  }

  // Auto-start tunnel if configured (default behavior)
  if (config.autoStart) {
    try {
      const { url: tunnelUrl, process: tunnelProcess } = await startCloudflaredTunnel(
        localUrl,
        config.cloudflaredPath
      );
      return {
        url: tunnelUrl,
        process: tunnelProcess,
        autoStarted: true,
      };
    } catch (error: any) {
      // If cloudflared is not installed, provide helpful error
      if (error.message.includes("not found") || error.message.includes("ENOENT")) {
        console.error("\n[tunnel] ❌ cloudflared is not installed.");
        console.error("[tunnel] Install it with: brew install cloudflare/cloudflare/cloudflared");
        console.error("[tunnel] Or set TUNNEL_URL environment variable to use an existing tunnel.\n");
        throw new Error(
          "cloudflared not installed. Install with: brew install cloudflare/cloudflare/cloudflared"
        );
      }
      console.error(`[tunnel] Failed to auto-start tunnel: ${error.message}`);
      throw error;
    }
  }

  // If auto-start is disabled, check for manual tunnel URL
  log("\n[tunnel] Tunnel required for Subconscious to reach local server.");
  log(`[tunnel] Start tunnel with: cloudflared tunnel --url ${localUrl}`);
  log("[tunnel] Then set TUNNEL_URL environment variable with the tunnel URL.\n");

  throw new Error(
    "Tunnel required but not started. Set TUNNEL_URL or enable auto-start in config."
  );
}

/**
 * Start cloudflared tunnel automatically.
 * Returns both the URL and the process for cleanup.
 */
async function startCloudflaredTunnel(
  localUrl: string,
  cloudflaredPath?: string
): Promise<{ url: string; process: ChildProcess }> {
  const cloudflared = cloudflaredPath || "cloudflared";

  // Check if cloudflared is available
  try {
    await checkCloudflaredInstalled(cloudflared);
  } catch (error: any) {
    throw new Error(
      `cloudflared not found: ${error.message}. Install with: brew install cloudflare/cloudflare/cloudflared`
    );
  }

  log("[tunnel] Starting cloudflared tunnel...");

  return new Promise((resolve, reject) => {
    // Spawn cloudflared process
    const tunnelProcess = spawn(cloudflared, ["tunnel", "--url", localUrl], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let tunnelUrl: string | null = null;
    let stderr = "";
    let stdout = "";
    let timeoutId: NodeJS.Timeout | null = null;

    // Parse tunnel URL from both stdout and stderr (cloudflared may use either)
    const checkForUrl = (output: string) => {
      if (tunnelUrl) return true; // Already found
      
      // Look for tunnel URL pattern: "https://xxxx-xxxx.trycloudflare.com"
      // Cloudflared outputs URLs in various formats, including in formatted boxes
      const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (urlMatch) {
        tunnelUrl = urlMatch[0];
        log(`[tunnel] ✓ Tunnel ready: ${tunnelUrl}`);
        if (timeoutId) clearTimeout(timeoutId);
        resolve({ url: tunnelUrl, process: tunnelProcess });
        return true;
      }
      return false;
    };

    tunnelProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      stdout += output;
      
      // Check for URL immediately
      if (checkForUrl(output)) {
        return; // URL found, done
      }

      // Log important messages (filter verbose output)
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && trimmed.includes("https://") && trimmed.includes("trycloudflare.com")) {
          // This might be the URL line, check it
          checkForUrl(trimmed);
        }
      }
    });

    tunnelProcess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      
      // Check stderr for URL too (cloudflared sometimes outputs URL to stderr)
      if (checkForUrl(output)) {
        return; // URL found, done
      }

      // Log errors and important messages
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes("error") || trimmed.includes("Error") || trimmed.includes("FATAL") || trimmed.includes("ERR")) {
          // Filter out connection errors that are normal during startup
          const isNormalError =
            trimmed.includes("Connection terminated") ||
            trimmed.includes("Retrying connection") ||
            trimmed.includes("originCertPath");
          if (!isNormalError) {
            console.error(`[tunnel] ${trimmed}`);
          }
        } else if (trimmed.includes("https://") && trimmed.includes("trycloudflare.com")) {
          // Check this line for URL
          checkForUrl(trimmed);
        }
      }
    });

    tunnelProcess.on("error", (error) => {
      reject(new Error(`Failed to start cloudflared: ${error.message}`));
    });

    tunnelProcess.on("exit", (code) => {
      if (code !== 0 && !tunnelUrl) {
        reject(
          new Error(
            `cloudflared exited with code ${code}. Error: ${stderr || "Unknown error"}`
          )
        );
      }
    });

    // Timeout after 45 seconds (cloudflared can take a moment to establish)
    timeoutId = setTimeout(() => {
      if (!tunnelUrl) {
        tunnelProcess.kill();
        reject(
          new Error(
            "Tunnel startup timeout. Check cloudflared installation and network connectivity."
          )
        );
      }
    }, 45000);
  });
}

/**
 * Check if cloudflared is installed and accessible.
 */
function checkCloudflaredInstalled(cloudflared: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(cloudflared, ["--version"], {
      stdio: "ignore",
    });

    process.on("error", (error: any) => {
      if (error.code === "ENOENT") {
        reject(new Error("cloudflared not found in PATH"));
      } else {
        reject(error);
      }
    });

    process.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`cloudflared --version exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop a tunnel process.
 */
export function stopTunnel(process?: ChildProcess): void {
  if (process) {
    process.kill();
    log("[tunnel] Tunnel stopped");
  }
}
