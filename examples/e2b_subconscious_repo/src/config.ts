/**
 * Configuration
 * 
 * Default settings for the agent. Can be overridden via environment variables
 * or an optional agent.config.json file.
 */

export interface AgentConfig {
  verbose: boolean; // Show detailed logs
  timeouts: {
    defaultExecution: number; // milliseconds
    maxExecution: number;
    perStep: number;
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
  limits: {
    maxSteps: number;
    maxRefinements: number;
  };
  tunnel: {
    enabled: boolean;
    autoStart: boolean;
    port: number;
    cloudflaredPath?: string;
  };
  tools: {
    port: number;
    host: string;
  };
}

// Global verbose flag - can be accessed anywhere
export let verbose = process.env.VERBOSE === "true";

export const defaultConfig: AgentConfig = {
  verbose: process.env.VERBOSE === "true", // Default false unless VERBOSE=true
  timeouts: {
    defaultExecution: 5 * 60 * 1000, // 5 minutes
    maxExecution: 30 * 60 * 1000, // 30 minutes
    perStep: 10 * 60 * 1000, // 10 minutes per step
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
  limits: {
    maxSteps: 10,
    maxRefinements: 3,
  },
  tunnel: {
    enabled: true,
    autoStart: true, // Automatically start cloudflared tunnel
    port: 3001, // Port for tool server
    cloudflaredPath: undefined, // Auto-detect from PATH
  },
  tools: {
    port: 3001,
    host: "localhost",
  },
};

/**
 * Load configuration from file if it exists.
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
    // Config file doesn't exist, use defaults
    return defaultConfig;
  }
}
