/**
 * Session Manager
 *
 * Manages sandbox session persistence between tasks.
 * Keeps the sandbox and tunnel alive to avoid re-initialization overhead.
 */

import { E2BSandbox } from "../e2b/sandbox";
import { E2BToolServer } from "../tools/e2bServer";
import {
  setupTunnel,
  stopTunnel,
  needsReconnection,
  reconnectTunnelIfNeeded,
  type TunnelResult,
} from "../tools/tunnel";
import { loadConfig, verbose, type AgentConfig } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Session state containing all resources.
 */
export interface Session {
  sandbox: E2BSandbox;
  toolServer: E2BToolServer;
  tunnelResult: TunnelResult;
  tunnelUrl: string;
  localUrl: string;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Session status information.
 */
export interface SessionStatus {
  active: boolean;
  sandboxId: string | null;
  tunnelUrl: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  idleTimeMs: number | null;
  totalDurationMs: number | null;
  isIdleTimedOut: boolean;
  isMaxDurationExceeded: boolean;
  tunnelHealthy: boolean;
}

/**
 * Session Manager
 *
 * Provides session persistence for sandbox, tool server, and tunnel.
 * Reuses resources between tasks to improve performance.
 */
export class SessionManager {
  private session: Session | null = null;
  private config: AgentConfig | null = null;
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Get or create a session.
   * If a session exists and is healthy, it will be reused.
   * Otherwise, a new session will be created.
   */
  async getOrCreateSession(): Promise<Session> {
    // Load config if not already loaded
    if (!this.config) {
      this.config = await loadConfig();
    }

    // Check if existing session is still valid
    if (this.session) {
      const isValid = await this.validateSession();
      if (isValid) {
        log("[session] Reusing existing session");
        this.session.lastUsedAt = Date.now();
        return this.session;
      } else {
        log("[session] Existing session invalid, creating new one");
        await this.cleanup();
      }
    }

    // Create new session
    return await this.createSession();
  }

  /**
   * Create a new session with all resources.
   */
  private async createSession(): Promise<Session> {
    if (!this.config) {
      this.config = await loadConfig();
    }

    log("[session] Creating new session...");
    const createdAt = Date.now();

    // Initialize sandbox
    const sandbox = new E2BSandbox(this.config);
    await sandbox.initialize();

    // Start tool server
    const toolServer = new E2BToolServer(
      sandbox,
      this.config.tools.port,
      this.config.tools.host
    );
    const localUrl = await toolServer.start();
    log(`[session] Tool server running at ${localUrl}`);

    // Setup tunnel
    const tunnelResult = await setupTunnel(localUrl, this.config.tunnel);
    log(`[session] Tunnel ready: ${tunnelResult.url}`);

    this.session = {
      sandbox,
      toolServer,
      tunnelResult,
      tunnelUrl: tunnelResult.url,
      localUrl,
      createdAt,
      lastUsedAt: createdAt,
    };

    // Start idle timeout checking
    this.startIdleCheck();

    log("[session] Session created successfully");
    return this.session;
  }

  /**
   * Validate that the current session is still usable.
   */
  private async validateSession(): Promise<boolean> {
    if (!this.session || !this.config) {
      return false;
    }

    const { sandbox, tunnelResult } = this.session;

    // Check sandbox health
    if (!sandbox.isAlive()) {
      log("[session] Sandbox is no longer alive");
      return false;
    }

    // Check session timeouts
    if (sandbox.isIdleTimedOut()) {
      log("[session] Session idle timeout exceeded");
      return false;
    }

    if (sandbox.isMaxDurationExceeded()) {
      log("[session] Session max duration exceeded");
      return false;
    }

    // Check tunnel health and reconnect if needed
    if (needsReconnection()) {
      log("[session] Tunnel unhealthy, attempting reconnection...");
      try {
        const newTunnel = await reconnectTunnelIfNeeded(
          tunnelResult,
          this.config.tunnel.port,
          this.config.retry.tunnel
        );
        this.session.tunnelResult = newTunnel;
        this.session.tunnelUrl = newTunnel.url;
      } catch (error: any) {
        log(`[session] Tunnel reconnection failed: ${error.message}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Start periodic idle checking.
   */
  private startIdleCheck(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    // Check every minute
    this.idleCheckInterval = setInterval(async () => {
      if (!this.session || !this.config) {
        return;
      }

      const { sandbox } = this.session;

      if (sandbox.isIdleTimedOut() || sandbox.isMaxDurationExceeded()) {
        log("[session] Session timeout triggered, cleaning up...");
        await this.cleanup();
      }
    }, 60000); // 1 minute

    // Don't block Node.js from exiting
    this.idleCheckInterval.unref();
  }

  /**
   * Mark the session as active (update last used time).
   */
  markActive(): void {
    if (this.session) {
      this.session.lastUsedAt = Date.now();
      this.session.sandbox.updateActivity();
    }
  }

  /**
   * Get current session status.
   */
  getStatus(): SessionStatus {
    if (!this.session) {
      return {
        active: false,
        sandboxId: null,
        tunnelUrl: null,
        createdAt: null,
        lastUsedAt: null,
        idleTimeMs: null,
        totalDurationMs: null,
        isIdleTimedOut: false,
        isMaxDurationExceeded: false,
        tunnelHealthy: true,
      };
    }

    const now = Date.now();
    const { sandbox, tunnelUrl, createdAt, lastUsedAt } = this.session;

    return {
      active: true,
      sandboxId: sandbox.getId(),
      tunnelUrl,
      createdAt,
      lastUsedAt,
      idleTimeMs: now - lastUsedAt,
      totalDurationMs: now - createdAt,
      isIdleTimedOut: sandbox.isIdleTimedOut(),
      isMaxDurationExceeded: sandbox.isMaxDurationExceeded(),
      tunnelHealthy: !needsReconnection(),
    };
  }

  /**
   * Check if a session exists and is active.
   */
  hasActiveSession(): boolean {
    return this.session !== null;
  }

  /**
   * Force create a new session (reset).
   * Cleans up existing session first.
   */
  async reset(): Promise<Session> {
    log("[session] Resetting session...");
    await this.cleanup();
    return await this.getOrCreateSession();
  }

  /**
   * Cleanup all session resources.
   */
  async cleanup(): Promise<void> {
    log("[session] Cleaning up session...");

    // Stop idle check
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    if (!this.session) {
      return;
    }

    const { sandbox, toolServer, tunnelResult } = this.session;

    // Stop tunnel
    try {
      stopTunnel(tunnelResult);
    } catch (error: any) {
      log(`[session] Error stopping tunnel: ${error.message}`);
    }

    // Stop tool server
    try {
      await toolServer.stop();
    } catch (error: any) {
      log(`[session] Error stopping tool server: ${error.message}`);
    }

    // Cleanup sandbox
    try {
      await sandbox.cleanup();
    } catch (error: any) {
      log(`[session] Error cleaning up sandbox: ${error.message}`);
    }

    this.session = null;
    log("[session] Session cleanup complete");
  }

  /**
   * Get the current session if it exists (without creating a new one).
   */
  getCurrentSession(): Session | null {
    return this.session;
  }
}

/**
 * Singleton session manager instance.
 */
let globalSessionManager: SessionManager | null = null;

/**
 * Get the global session manager instance.
 */
export function getSessionManager(): SessionManager {
  if (!globalSessionManager) {
    globalSessionManager = new SessionManager();
  }
  return globalSessionManager;
}

/**
 * Reset the global session manager (for testing).
 */
export async function resetGlobalSessionManager(): Promise<void> {
  if (globalSessionManager) {
    await globalSessionManager.cleanup();
    globalSessionManager = null;
  }
}
