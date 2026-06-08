// Config = your settings (API key, model, etc.), nothing more. We persist them with
// `conf` (atomic, cross-platform) and validate through a Zod schema so a hand-edited
// config file can never crash the app. Add a setting by adding it to `ConfigSchema`.

import Conf from "conf";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const DEFAULT_BASE_URL = "https://api.subconscious.dev/v1";
export const DEFAULT_MODEL = "subconscious/tim-qwen3.6-27b";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  apiKey: z.string().optional(), // or SUBCONSCIOUS_API_KEY env var (env wins)
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  enableThinking: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

// Keys a user is allowed to poke at via `sub config set <key> <value>`.
export const ALLOWED_CONFIG_KEYS = ["apiKey", "model", "baseUrl", "enableThinking"] as const;
export type AllowedConfigKey = (typeof ALLOWED_CONFIG_KEYS)[number];

// ---------------------------------------------------------------------------
// .env support (dependency-free)
// ---------------------------------------------------------------------------

// We don't pull in `dotenv` — we just read ./.env ourselves: parse `KEY=VALUE`
// lines and only set vars that aren't already in the environment (a real `export`
// always wins).
function loadDotEnv(): void {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  try {
    for (const rawLine of readFileSync(envPath, "utf-8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // A malformed .env shouldn't take down the CLI — just ignore it.
  }
}

loadDotEnv();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = new Conf<Record<string, unknown>>({ projectName: "subconscious-cli" });

/** Read the persisted config, applying defaults + validation. Always a fresh object. */
export function getConfig(): Config {
  return ConfigSchema.parse({ ...store.store });
}

/** Absolute path to the config file on disk (used by `sub config path`). */
export function getConfigPath(): string {
  return store.path;
}

/** Resolve the API key: env wins, then config file, else a friendly error. */
export function resolveApiKey(config: Config): string {
  const fromEnv = process.env.SUBCONSCIOUS_API_KEY?.trim();
  const key = fromEnv || config.apiKey?.trim();
  if (!key) {
    throw new Error(
      "No Subconscious API key found.\n" +
        "  • Set the env var:  export SUBCONSCIOUS_API_KEY=your_key\n" +
        "  • Or store it:      sub config set apiKey your_key\n" +
        "Grab a key at https://www.subconscious.dev/platform",
    );
  }
  return key;
}

/** `***` + last 4 chars, for display. Never print the whole key. */
export function redactApiKey(key: string | undefined): string {
  if (!key) return "(not set)";
  return key.length <= 4 ? "***" : `***${key.slice(-4)}`;
}

/** Set one allowed key. Returns the new config (we never mutate in place). */
export function setConfigValue(key: AllowedConfigKey, rawValue: string): Config {
  const current = getConfig();
  const next: Config =
    key === "enableThinking"
      ? { ...current, enableThinking: parseBoolean(rawValue) }
      : { ...current, [key]: rawValue };

  const validated = ConfigSchema.parse(next);
  store.set(validated);
  return validated;
}

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}
