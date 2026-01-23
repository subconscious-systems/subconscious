/**
 * Configuration
 *
 * Default settings for the agent. Can be overridden via environment variables
 * or an optional agent.config.json file.
 */

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
  tunnel: {
    enabled: boolean;
    autoStart: boolean;
    port: number;
  };
  tools: {
    port: number;
    host: string;
  };
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
  tunnel: {
    enabled: true,
    autoStart: true,
    port: 3001,
  },
  tools: {
    port: 3001,
    host: "localhost",
  },
};

/**
 * Load configuration from file if it exists, otherwise use defaults.
 */
export async function loadConfig(): Promise<AgentConfig> {
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const configPath = path.join(process.cwd(), "agent.config.json");

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content);
    return { ...defaultConfig, ...userConfig };
  } catch {
    return defaultConfig;
  }
}
