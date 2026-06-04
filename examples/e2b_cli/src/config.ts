/**
 * Configuration
 *
 * Default settings for the agent. Can be overridden via environment variables
 * or an optional agent.config.json file.
 */

import type { RetryOptions } from "./utils/retry";
import type { ValidationConfig } from "./utils/validation";

/**
 * Retry configuration for different operation types.
 */
export interface RetryConfig {
  sandbox: RetryOptions;
  api: RetryOptions;
  execution: RetryOptions;
}

/**
 * Session configuration for sandbox persistence.
 */
export interface SessionConfig {
  /** Enable session persistence between tasks */
  enabled: boolean;
  /** Idle timeout in milliseconds before cleanup (default: 30 min) */
  idleTimeoutMs: number;
  /** Maximum session duration in milliseconds (default: 2 hours) */
  maxDurationMs: number;
}

export interface AgentConfig {
  verbose: boolean;
  timeouts: {
    defaultExecution: number; // milliseconds
    maxExecution: number;
  };
  files: {
    maxSizeMB: number;
    outputDirectory: string;
    allowedExtensions: string[];
  };
  environment: {
    filterSensitive: boolean;
    sensitivePatterns: string[];
  };
  retry: RetryConfig;
  validation: ValidationConfig;
  session: SessionConfig;
}

/** Global verbose flag */
export const verbose = process.env.VERBOSE === "true";

export const defaultConfig: AgentConfig = {
  verbose: process.env.VERBOSE === "true",
  timeouts: {
    defaultExecution: 5 * 60 * 1000, // 5 minutes
    maxExecution: 30 * 60 * 1000, // 30 minutes
  },
  files: {
    maxSizeMB: 10,
    outputDirectory: "./output",
    allowedExtensions: [
      ".csv",
      ".json",
      ".txt",
      ".py",
      ".js",
      ".ts",
      ".md",
      ".html",
      ".xml",
      ".yaml",
      ".yml",
    ],
  },
  environment: {
    filterSensitive: true,
    sensitivePatterns: [
      "SUBCONSCIOUS_API_KEY",
      "E2B_API_KEY",
      "PASSWORD",
      "SECRET",
      "TOKEN",
      "KEY",
      "API_KEY",
    ],
  },
  retry: {
    sandbox: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "503", "timeout", "network"],
    },
    api: {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      retryableErrors: ["ECONNRESET", "ETIMEDOUT", "503", "502", "504", "rate limit"],
    },
    execution: {
      maxAttempts: 2,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      retryableErrors: ["ECONNRESET", "sandbox", "connection"],
      nonRetryableErrors: ["SyntaxError", "TypeError", "ReferenceError", "NameError", "IndentationError"],
    },
  },
  validation: {
    maxTaskLength: 10000,
    maxFileSizeMB: 10,
    allowedSandboxDirs: ["/home/user/input", "/home/user/output", "/home/user", "/tmp"],
    blockedPatterns: ["../", "/etc/", "/var/", "/root/", "/proc/", "/sys/", "/dev/"],
    allowedExtensions: [
      ".csv", ".json", ".txt", ".py", ".js", ".ts", ".md", ".html",
      ".xml", ".yaml", ".yml", ".png", ".jpg", ".jpeg", ".gif", ".webp",
      ".svg", ".pdf", ".zip", ".tar", ".gz",
    ],
  },
  session: {
    enabled: true,
    idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxDurationMs: 2 * 60 * 60 * 1000, // 2 hours
  },
};

/**
 * Deep merge helper for nested config objects.
 * Uses `unknown` casts internally to avoid index-signature requirements.
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...(target as object) } as T;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue: unknown = source[key];
      const targetValue: unknown = (target as Record<string, unknown>)[key];

      if (
        sourceValue !== null &&
        sourceValue !== undefined &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        targetValue !== undefined &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Partial<Record<string, unknown>>,
        );
      } else if (sourceValue !== undefined) {
        (result as Record<string, unknown>)[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Load configuration from file if it exists, otherwise use defaults.
 */
export async function loadConfig(): Promise<AgentConfig> {
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const configPath = path.join(process.cwd(), "agent.config.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<AgentConfig>;
    return deepMerge<AgentConfig>(defaultConfig, userConfig);
  } catch {
    return defaultConfig;
  }
}

/**
 * Get the current config (sync version using defaults).
 * For async config loading with file overrides, use loadConfig().
 */
export function getDefaultConfig(): AgentConfig {
  return defaultConfig;
}
