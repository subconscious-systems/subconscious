// `sub config show | set | path` — read and edit persisted settings.

import type { Command } from "commander";
import {
  ALLOWED_CONFIG_KEYS,
  type AllowedConfigKey,
  getConfig,
  getConfigPath,
  redactApiKey,
  setConfigValue,
} from "../lib/config.js";

export function registerConfig(program: Command): void {
  const config = program.command("config").description("view and edit configuration");

  config
    .command("show")
    .description("show current config (API key redacted)")
    .action(showConfig);

  config
    .command("set <key> <value>")
    .description(`set a value. keys: ${ALLOWED_CONFIG_KEYS.join(", ")}`)
    .action((key: string, value: string) => {
      if (!ALLOWED_CONFIG_KEYS.includes(key as AllowedConfigKey)) {
        throw new Error(`Unknown key "${key}". Allowed: ${ALLOWED_CONFIG_KEYS.join(", ")}`);
      }
      setConfigValue(key as AllowedConfigKey, value);
      const shown = key === "apiKey" ? redactApiKey(value) : value;
      process.stdout.write(`Set ${key} = ${shown}\n`);
    });

  config
    .command("path")
    .description("print the path to the config file")
    .action(() => {
      process.stdout.write(`${getConfigPath()}\n`);
    });
}

function showConfig(): void {
  const c = getConfig();
  const lines = [
    `apiKey:         ${redactApiKey(c.apiKey)}`,
    `baseUrl:        ${c.baseUrl}`,
    `model:          ${c.model}`,
    `enableThinking: ${c.enableThinking}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
