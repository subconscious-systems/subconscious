/**
 * API Key Onboarding
 * 
 * Interactive setup flow for first-time users to configure their API keys.
 * Keys are saved to ~/.subcon/config.json for future sessions.
 */

import * as readline from "readline";
import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".subcon");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** ANSI color codes */
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  underline: "\x1b[4m",
} as const;

interface StoredConfig {
  subconscious_api_key?: string;
  e2b_api_key?: string;
}

/**
 * Load saved API keys from config file
 */
async function loadSavedKeys(): Promise<StoredConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save API keys to config file
 */
async function saveKeys(config: StoredConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  // Make file readable only by owner
  await fs.chmod(CONFIG_FILE, 0o600);
}

/**
 * Open URL in default browser
 */
function openBrowser(url: string): void {
  const { exec } = require("child_process");
  const cmd = process.platform === "darwin" 
    ? `open "${url}"` 
    : process.platform === "win32" 
      ? `start "${url}"` 
      : `xdg-open "${url}"`;
  exec(cmd);
}

/**
 * Prompt user for input
 */
function prompt(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Run the onboarding flow
 * Returns true if keys are now available, false if user cancelled
 */
export async function runOnboarding(): Promise<boolean> {
  // First check environment variables
  let subconKey = process.env.SUBCONSCIOUS_API_KEY;
  let e2bKey = process.env.E2B_API_KEY;

  // Then check saved config
  const savedConfig = await loadSavedKeys();
  if (!subconKey && savedConfig.subconscious_api_key) {
    subconKey = savedConfig.subconscious_api_key;
    process.env.SUBCONSCIOUS_API_KEY = subconKey;
  }
  if (!e2bKey && savedConfig.e2b_api_key) {
    e2bKey = savedConfig.e2b_api_key;
    process.env.E2B_API_KEY = e2bKey;
  }

  // If both keys are set, we're good
  if (subconKey && e2bKey) {
    return true;
  }

  // Need to run onboarding
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log(`
${c.cyan}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.cyan}${c.bold}  🔑 API Key Setup${c.reset}
${c.cyan}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}

  This CLI requires two API keys to work:

  ${c.bold}1. Subconscious API Key${c.reset} ${c.dim}(for AI reasoning)${c.reset}
     ${c.underline}${c.blue}https://subconscious.dev/platform${c.reset}

  ${c.bold}2. E2B API Key${c.reset} ${c.dim}(for code sandbox)${c.reset}
     ${c.underline}${c.blue}https://e2b.dev${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}
`);

  try {
    // Subconscious API Key
    if (!subconKey) {
      const openSubcon = await prompt(
        rl, 
        `${c.green}▸${c.reset} Open ${c.cyan}subconscious.dev${c.reset} to get your key? ${c.dim}(Y/n)${c.reset} `
      );
      
      if (openSubcon.toLowerCase() !== "n") {
        openBrowser("https://subconscious.dev/platform");
        console.log(`${c.dim}  → Browser opened. Sign up or log in to get your API key.${c.reset}\n`);
      }

      subconKey = await prompt(
        rl,
        `${c.green}▸${c.reset} ${c.bold}Subconscious API Key:${c.reset} `
      );

      if (!subconKey) {
        console.log(`\n${c.red}✗ API key is required.${c.reset}\n`);
        rl.close();
        return false;
      }
    } else {
      console.log(`${c.green}✓${c.reset} Subconscious API key ${c.dim}(already set)${c.reset}`);
    }

    // E2B API Key  
    if (!e2bKey) {
      console.log();
      const openE2B = await prompt(
        rl,
        `${c.green}▸${c.reset} Open ${c.yellow}e2b.dev${c.reset} to get your key? ${c.dim}(Y/n)${c.reset} `
      );

      if (openE2B.toLowerCase() !== "n") {
        openBrowser("https://e2b.dev");
        console.log(`${c.dim}  → Browser opened. Sign up or log in to get your API key.${c.reset}\n`);
      }

      e2bKey = await prompt(
        rl,
        `${c.green}▸${c.reset} ${c.bold}E2B API Key:${c.reset} `
      );

      if (!e2bKey) {
        console.log(`\n${c.red}✗ API key is required.${c.reset}\n`);
        rl.close();
        return false;
      }
    } else {
      console.log(`${c.green}✓${c.reset} E2B API key ${c.dim}(already set)${c.reset}`);
    }

    // Save keys
    const saveChoice = await prompt(
      rl,
      `\n${c.green}▸${c.reset} Save keys for future sessions? ${c.dim}(Y/n)${c.reset} `
    );

    if (saveChoice.toLowerCase() !== "n") {
      await saveKeys({
        subconscious_api_key: subconKey,
        e2b_api_key: e2bKey,
      });
      console.log(`${c.green}✓${c.reset} Keys saved to ${c.dim}~/.subcon/config.json${c.reset}`);
    }

    // Set environment variables for this session
    process.env.SUBCONSCIOUS_API_KEY = subconKey;
    process.env.E2B_API_KEY = e2bKey;

    console.log(`
${c.green}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.green}${c.bold}  ✓ Setup complete! You're ready to go.${c.reset}
${c.green}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);

    rl.close();
    return true;
  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Check if keys are configured (env vars or saved config)
 */
export async function hasApiKeys(): Promise<{ subconscious: boolean; e2b: boolean }> {
  const savedConfig = await loadSavedKeys();
  return {
    subconscious: !!(process.env.SUBCONSCIOUS_API_KEY || savedConfig.subconscious_api_key),
    e2b: !!(process.env.E2B_API_KEY || savedConfig.e2b_api_key),
  };
}

/**
 * Load saved keys into environment if not already set
 */
export async function loadKeysIntoEnv(): Promise<void> {
  const savedConfig = await loadSavedKeys();
  
  if (!process.env.SUBCONSCIOUS_API_KEY && savedConfig.subconscious_api_key) {
    process.env.SUBCONSCIOUS_API_KEY = savedConfig.subconscious_api_key;
  }
  if (!process.env.E2B_API_KEY && savedConfig.e2b_api_key) {
    process.env.E2B_API_KEY = savedConfig.e2b_api_key;
  }
}
