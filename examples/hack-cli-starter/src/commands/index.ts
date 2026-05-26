// The CLI command registry. To add a `sub <command>`: copy _template.ts, then add its
// register function to the array below. (`chat` is the default — bare `sub` runs it.)

import type { Command } from "commander";
import { registerChat } from "./chat.js";
import { registerConfig } from "./config.js";
import { registerInit } from "./init.js";

// 👉 Register new commands here.
export const COMMANDS: Array<(program: Command) => void> = [registerChat, registerConfig, registerInit];
