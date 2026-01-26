import localtunnel from "localtunnel";
import { verbose, defaultConfig, type AgentConfig } from "../config";
import { withRetry, type RetryOptions } from "../utils/retry";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Tunnel Support
 *
 * Handles tunnel setup for exposing local HTTP server to Subconscious.
 * Uses localtunnel (npm package) - no external dependencies required.
 * Includes retry logic for transient failures and health monitoring.
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
  /** Health check interval ID for cleanup */
  healthCheckInterval?: ReturnType<typeof setInterval>;
}

/** Tunnel health status */
export interface TunnelHealth {
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  error?: string;
}

/** Current tunnel health state (module-level for singleton access) */
let tunnelHealth: TunnelHealth = {
  isHealthy: true,
  lastChecked: 0,
  consecutiveFailures: 0,
};

/**
 * Get current tunnel health status.
 */
export function getTunnelHealth(): TunnelHealth {
  return { ...tunnelHealth };
}

/**
 * Get tunnel URL from environment or start a new one.
 * Uses retry logic for transient failures.
 *
 * @param localUrl - Local server URL to tunnel
 * @param tunnelConfig - Tunnel configuration
 * @param retryConfig - Optional retry configuration
 */
export async function setupTunnel(
  localUrl: string,
  tunnelConfig: TunnelConfig,
  retryConfig?: RetryOptions
): Promise<TunnelResult> {
  // Check for existing tunnel URL in environment
  const existingTunnelUrl = process.env.TUNNEL_URL;
  if (existingTunnelUrl) {
    log(`[tunnel] Using existing tunnel URL: ${existingTunnelUrl}`);
    return { url: existingTunnelUrl, autoStarted: false };
  }

  // If tunnel is not enabled, return local URL (won't work but user will see error)
  if (!tunnelConfig.enabled) {
    console.warn(
      "[tunnel] Tunnel not enabled. Subconscious won't be able to reach local server."
    );
    console.warn(
      "[tunnel] Set TUNNEL_URL environment variable or enable auto-start in config."
    );
    return { url: localUrl, autoStarted: false };
  }

  // Auto-start tunnel if configured
  if (tunnelConfig.autoStart) {
    const options = retryConfig || defaultConfig.retry.tunnel;
    return startLocaltunnelWithRetry(tunnelConfig.port, options);
  }

  log("\n[tunnel] Tunnel required for Subconscious to reach local server.");
  log("[tunnel] Set TUNNEL_URL environment variable with the tunnel URL.\n");

  throw new Error(
    "Tunnel required but not started. Set TUNNEL_URL or enable auto-start in config."
  );
}

/**
 * Start localtunnel with retry logic.
 */
async function startLocaltunnelWithRetry(
  port: number,
  retryOptions: RetryOptions
): Promise<TunnelResult> {
  log("[tunnel] Starting localtunnel...");

  return withRetry(
    async () => {
      const tunnel = await localtunnel({ port });

      log(`[tunnel] ✓ Tunnel ready: ${tunnel.url}`);

      // Reset health state on successful connection
      tunnelHealth = {
        isHealthy: true,
        lastChecked: Date.now(),
        consecutiveFailures: 0,
      };

      tunnel.on("error", (err) => {
        console.error(`[tunnel] localtunnel error: ${err.message}`);
        tunnelHealth.isHealthy = false;
        tunnelHealth.error = err.message;
        tunnelHealth.consecutiveFailures++;
      });

      tunnel.on("close", () => {
        log("[tunnel] localtunnel closed");
        tunnelHealth.isHealthy = false;
      });

      // Start health monitoring
      const healthCheckInterval = startHealthMonitoring(tunnel, port);

      return {
        url: tunnel.url,
        tunnel,
        autoStarted: true,
        healthCheckInterval,
      };
    },
    retryOptions,
    (attempt, error, delayMs) => {
      log(`[tunnel] Connection attempt ${attempt} failed: ${error.message}`);
      log(`[tunnel] Retrying in ${delayMs}ms...`);
    }
  ).catch((error: any) => {
    console.error("\n[tunnel] ❌ Could not start tunnel after retries.");
    console.error("[tunnel] Error:", error.message);
    console.error("\n[tunnel] Options:");
    console.error("  1. Check your network connection");
    console.error(
      "  2. Set TUNNEL_URL environment variable to use an existing tunnel\n"
    );
    throw new Error(`Failed to start localtunnel: ${error.message}`);
  });
}

/**
 * Start health monitoring for the tunnel.
 * Periodically checks if the tunnel is still responding.
 *
 * @param tunnel - The localtunnel instance
 * @param port - Local port for fallback health check
 * @returns Interval ID for cleanup
 */
function startHealthMonitoring(
  tunnel: localtunnel.Tunnel,
  port: number
): ReturnType<typeof setInterval> {
  const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  const MAX_CONSECUTIVE_FAILURES = 3;

  const interval = setInterval(async () => {
    try {
      // Try to hit the health endpoint through the tunnel
      const healthUrl = `${tunnel.url}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        tunnelHealth = {
          isHealthy: true,
          lastChecked: Date.now(),
          consecutiveFailures: 0,
        };
        log("[tunnel] Health check passed");
      } else {
        tunnelHealth.consecutiveFailures++;
        tunnelHealth.lastChecked = Date.now();
        tunnelHealth.error = `HTTP ${response.status}`;
        log(`[tunnel] Health check failed: HTTP ${response.status}`);
      }
    } catch (error: any) {
      tunnelHealth.consecutiveFailures++;
      tunnelHealth.lastChecked = Date.now();
      tunnelHealth.error = error.message;
      
      // Only log if this is a new failure or we're close to max failures
      if (tunnelHealth.consecutiveFailures <= 2 || 
          tunnelHealth.consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
        const failures = tunnelHealth.consecutiveFailures;
        log(`[tunnel] Health check failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${error.message}`);
      }
    }

    // Mark as unhealthy after max consecutive failures
    if (tunnelHealth.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      tunnelHealth.isHealthy = false;
      console.warn("[tunnel] ⚠ Tunnel appears to be unhealthy. Consider restarting.");
    }
  }, HEALTH_CHECK_INTERVAL);

  // Don't block Node.js from exiting
  interval.unref();

  return interval;
}

/**
 * Attempt to reconnect the tunnel if it's unhealthy.
 *
 * @param currentResult - Current tunnel result
 * @param port - Port to reconnect on
 * @param retryOptions - Retry configuration
 * @returns New tunnel result if reconnected, original if healthy or on failure
 */
export async function reconnectTunnelIfNeeded(
  currentResult: TunnelResult,
  port: number,
  retryOptions?: RetryOptions
): Promise<TunnelResult> {
  if (tunnelHealth.isHealthy) {
    return currentResult;
  }

  log("[tunnel] Attempting to reconnect tunnel...");

  // Stop the old tunnel
  stopTunnel(currentResult);

  // Start a new one
  try {
    const options = retryOptions || defaultConfig.retry.tunnel;
    return await startLocaltunnelWithRetry(port, options);
  } catch (error: any) {
    console.error("[tunnel] Failed to reconnect:", error.message);
    // Return the old result (caller can check health status)
    return currentResult;
  }
}

/**
 * Stop the tunnel and cleanup health monitoring.
 */
export function stopTunnel(result?: TunnelResult): void {
  if (result?.healthCheckInterval) {
    clearInterval(result.healthCheckInterval);
    log("[tunnel] Health monitoring stopped");
  }
  
  if (result?.tunnel) {
    result.tunnel.close();
    log("[tunnel] Tunnel stopped");
  }

  // Reset health state
  tunnelHealth = {
    isHealthy: true,
    lastChecked: 0,
    consecutiveFailures: 0,
  };
}

/**
 * Check if tunnel needs reconnection based on health status.
 */
export function needsReconnection(): boolean {
  return !tunnelHealth.isHealthy && tunnelHealth.consecutiveFailures >= 3;
}
