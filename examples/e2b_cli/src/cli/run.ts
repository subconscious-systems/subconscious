/**
 * CLI runner — interactive REPL with session persistence.
 *
 * Architecture (new):
 *   User input → client-side ReAct loop → E2B sandbox (direct, no HTTP server)
 *
 * The old design proxied tool calls through a local HTTP server exposed via
 * localtunnel so the Subconscious cloud could reach them. The new design runs
 * the entire loop in this process using the OpenAI-compatible Subconscious
 * endpoint and calls E2B directly — no tunnel required.
 */

import * as readline from "readline";
import { E2BSandbox } from "../e2b/sandbox.js";
import { runOnboarding, loadKeysIntoEnv } from "./onboarding.js";
import { loadConfig, verbose } from "../config.js";
import { createClient } from "../lib/client.js";
import { runAgent, isAbortError, type AgentEvent } from "../agent/loop.js";
import { validateTaskInputs, type ValidationResult } from "../utils/validation.js";

/** Log only when verbose mode is enabled */
function log(message: string): void {
  if (verbose) process.stdout.write(`${message}\n`);
}

/** Spinner frames for loading animation */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** ANSI colour codes */
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
} as const;

type Colors = typeof COLORS;

/** Simple loading spinner */
class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    this.stop();
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex];
      process.stdout.write(`\r\x1b[36m${frame}\x1b[0m ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write("\r\x1b[K\x1b[?25h"); // clear line, show cursor
    }
  }
}

/** Sandbox session — kept alive between tasks to save startup time. */
interface SandboxSession {
  sandbox: E2BSandbox;
}

/** Display validation results; returns false if validation failed. */
function displayValidationResult(
  validation: ValidationResult,
  c: Colors,
): boolean {
  for (const warning of validation.warnings) {
    process.stdout.write(`${c.yellow}⚠ Warning:${c.reset} ${warning}\n`);
  }
  if (!validation.valid) {
    process.stdout.write(`\n${c.red}${c.bold}✗ Validation failed:${c.reset}\n`);
    for (const error of validation.errors) {
      process.stdout.write(`  ${c.red}•${c.reset} ${error}\n`);
    }
    process.stdout.write("\n");
    return false;
  }
  return true;
}

/** Render a single agent event to stdout. */
function renderEvent(event: AgentEvent, c: Colors): void {
  switch (event.type) {
    case "thinking":
      // The spinner already indicates activity — no extra output.
      break;

    case "tool_call": {
      const { tool, args } = event;
      if (tool === "execute_code" && typeof args["code"] === "string") {
        const preview = args["code"].slice(0, 100) + (args["code"].length > 100 ? "..." : "");
        process.stdout.write(`🔧 Executing code: ${preview}\n\n`);
      } else if (tool === "upload_local_file") {
        process.stdout.write(`📤 Uploading: ${String(args["local_path"] ?? "")}\n\n`);
      } else if (tool === "download_file") {
        process.stdout.write(
          `📥 Downloading: ${String(args["sandbox_path"] ?? "")} → ${String(args["local_path"] ?? "")}\n\n`,
        );
      } else if (tool === "check_local_file") {
        process.stdout.write(`🔍 Checking file: ${String(args["path"] ?? "")}\n\n`);
      } else {
        process.stdout.write(`🔧 Calling tool: ${tool}\n\n`);
      }
      break;
    }

    case "tool_result":
      log(`[tool] ${event.tool} → ${event.result.slice(0, 120)}`);
      break;

    case "tool_error":
      process.stdout.write(`${c.red}✗ Tool "${event.tool}" failed:${c.reset} ${event.error}\n\n`);
      break;

    case "final":
      process.stdout.write(`\n${"=".repeat(60)}\n`);
      process.stdout.write(`${c.magenta}${c.bold}📋 Final Answer:${c.reset}\n\n`);
      process.stdout.write(`${c.cyan}${event.content}${c.reset}\n\n`);
      break;

    case "error":
      process.stdout.write(`\n${c.red}❌ ${event.error}${c.reset}\n`);
      break;
  }
}

/**
 * Run one task through the agent loop on a given sandbox.
 */
async function runTask(
  session: SandboxSession,
  taskDescription: string,
  context: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  c: Colors,
  spinner: Spinner,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  const client = createClient();
  const userMessage = context.trim()
    ? `${taskDescription}\n\nAdditional context: ${context}`
    : taskDescription;

  spinner.start();

  let spinnerStopped = false;
  const stopSpinnerOnce = () => {
    if (!spinnerStopped) {
      spinner.stop();
      spinnerStopped = true;
    }
  };

  try {
    const finalAnswer = await runAgent({
      client,
      sandbox: session.sandbox,
      userMessage,
      history,
      enableThinking: false,
      onEvent: (event) => {
        // Stop spinner on first visible event so it doesn't fight with output.
        if (event.type !== "thinking") {
          stopSpinnerOnce();
          process.stdout.write(`\n${"=".repeat(60)}\n\n`);
        }
        renderEvent(event, c);
      },
      signal: abortSignal,
    });

    stopSpinnerOnce();
    return finalAnswer;
  } catch (err) {
    stopSpinnerOnce();
    if (isAbortError(err)) {
      process.stdout.write(`\n${c.yellow}Task cancelled.${c.reset}\n`);
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n${c.red}❌ Task failed:${c.reset} ${message}\n`);
    return null;
  }
}

/**
 * Run agent with a provided task (non-interactive, for programmatic use / tests).
 * Creates a fresh sandbox for each call.
 */
export async function runAgentWithTask(
  taskDescription: string,
  context?: string,
): Promise<void> {
  await loadKeysIntoEnv();

  if (!process.env.SUBCONSCIOUS_API_KEY) {
    throw new Error(
      "SUBCONSCIOUS_API_KEY environment variable is not set. " +
        "Get your API key at: https://www.subconscious.dev/platform",
    );
  }

  const config = await loadConfig();
  const validation = await validateTaskInputs(taskDescription, config.validation);
  if (!displayValidationResult(validation, COLORS)) {
    throw new Error("Input validation failed");
  }

  const sandbox = new E2BSandbox(config);
  const spinner = new Spinner("Initializing sandbox...");
  spinner.start();

  try {
    await sandbox.initialize();
    spinner.stop();
    process.stdout.write("\x1b[32m✓\x1b[0m Sandbox ready\n\n");

    const client = createClient();
    const userMessage = context?.trim()
      ? `${taskDescription}\n\nAdditional context: ${context}`
      : taskDescription;

    await runAgent({
      client,
      sandbox,
      userMessage,
      history: [],
      enableThinking: false,
      onEvent: (event) => {
        renderEvent(event, COLORS);
      },
    });
  } finally {
    spinner.stop();
    await sandbox.cleanup();
  }
}

/**
 * Interactive CLI entrypoint with command history, session persistence, and
 * conversation history across turns.
 */
export async function runAgent_cli(): Promise<void> {
  await loadKeysIntoEnv();

  if (!process.env.SUBCONSCIOUS_API_KEY || !process.env.E2B_API_KEY) {
    const success = await runOnboarding();
    if (!success) {
      process.exit(1);
    }
  }

  const config = await loadConfig();
  const c = COLORS;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  const cmdHistory: string[] = [];

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      (rl as unknown as { history: string[] }).history = [...cmdHistory];
      rl.question(prompt, (answer) => {
        const trimmed = answer.trim();
        if (trimmed && !cmdHistory.includes(trimmed)) {
          cmdHistory.unshift(trimmed);
          if (cmdHistory.length > 100) cmdHistory.pop();
        }
        resolve(trimmed);
      });
    });

  // ASCII art banner
  process.stdout.write(`
${c.cyan}${c.bold}  ┌─┐┬ ┬┌┐ ┌─┐┌─┐┌┐┌┌─┐┌─┐┬┌─┐┬ ┬┌─┐
  └─┐│ │├┴┐│  │ ││││└─┐│  ││ ││ │└─┐
  └─┘└─┘└─┘└─┘└─┘┘└┘└─┘└─┘┴└─┘└─┘└─┘${c.reset}  ${c.dim}+ E2B Sandbox${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}

  ${c.green}▸${c.reset} ${c.bold}Powered by${c.reset}
    ${c.cyan}Subconscious${c.reset} ${c.dim}─${c.reset} Client-side ReAct loop via OpenAI-compatible API
    ${c.yellow}E2B Sandbox${c.reset}  ${c.dim}─${c.reset} Secure cloud code execution

  ${c.green}▸${c.reset} ${c.bold}What You Can Do${c.reset}
    ${c.dim}•${c.reset} Reference local files naturally: ${c.cyan}~/Desktop/data.csv${c.reset}
    ${c.dim}•${c.reset} Ask for outputs: ${c.cyan}"save a chart to chart.png"${c.reset}
    ${c.dim}•${c.reset} The agent handles file uploads and downloads automatically

  ${c.green}▸${c.reset} ${c.bold}Commands${c.reset}
    ${c.dim}•${c.reset} ${c.white}reset${c.reset}  ${c.dim}─${c.reset} Reset the sandbox session
    ${c.dim}•${c.reset} ${c.white}clear${c.reset}  ${c.dim}─${c.reset} Clear the screen
    ${c.dim}•${c.reset} ${c.white}exit${c.reset}   ${c.dim}─${c.reset} Exit the CLI

  ${c.green}▸${c.reset} ${c.bold}Example${c.reset}
    ${c.dim}"Analyze ~/Desktop/sales.csv and create a bar chart, save it to chart.png"${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}
`);

  // Session state
  let session: SandboxSession | null = null;
  let sessionInitialized = false;
  // Multi-turn conversation history (preserved across tasks in the same session)
  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const cleanupSession = async (): Promise<void> => {
    if (session) {
      process.stdout.write(`\n${c.dim}Cleaning up sandbox...${c.reset}\n`);
      try {
        await session.sandbox.cleanup();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[cleanup] ${msg}`);
      }
      session = null;
      sessionInitialized = false;
    }
    rl.close();
  };

  process.on("SIGINT", async () => {
    await cleanupSession();
    process.exit(0);
  });

  const spinner = new Spinner("Working...");

  while (true) {
    const taskDescription = await question(
      `${c.green}${c.bold}▸${c.reset} ${c.bold}Task${c.reset} ${c.dim}›${c.reset} `,
    );

    // Handle exit
    if (
      !taskDescription ||
      taskDescription.toLowerCase() === "exit" ||
      taskDescription.toLowerCase() === "quit"
    ) {
      process.stdout.write(`\n${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`);
      process.stdout.write(`${c.cyan}${c.bold}  👋 Until next time!${c.reset}\n`);
      process.stdout.write(`${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n\n`);
      await cleanupSession();
      break;
    }

    // Handle clear
    if (taskDescription.toLowerCase() === "clear") {
      process.stdout.write("\x1b[2J\x1b[H");
      continue;
    }

    // Handle reset
    if (taskDescription.toLowerCase() === "reset") {
      process.stdout.write(`${c.yellow}Resetting session...${c.reset}\n`);
      await cleanupSession();
      conversationHistory.length = 0;
      process.stdout.write(`${c.green}✓ Session reset${c.reset}\n\n`);
      continue;
    }

    // Validate input
    const validation = await validateTaskInputs(taskDescription, config.validation);
    if (!displayValidationResult(validation, c)) {
      continue;
    }

    const contextInput = await question(
      `${c.blue}${c.bold}▸${c.reset} ${c.bold}Context${c.reset} ${c.dim}(optional)${c.reset} ${c.dim}›${c.reset} `,
    );

    try {
      // Lazy-initialize sandbox session
      if (!sessionInitialized || !session) {
        spinner.update("Initializing sandbox...");
        spinner.start();
        try {
          const sandbox = new E2BSandbox(config);
          await sandbox.initialize();
          session = { sandbox };
          sessionInitialized = true;
          spinner.stop();
          process.stdout.write(`${c.green}✓${c.reset} Session ready\n\n`);
        } catch (err) {
          spinner.stop();
          throw err;
        }
      }

      spinner.update("Thinking...");

      const finalAnswer = await runTask(
        session,
        taskDescription,
        contextInput,
        conversationHistory,
        c,
        spinner,
      );

      // Persist the exchange in conversation history for continuity
      if (finalAnswer !== null) {
        conversationHistory.push({ role: "user", content: taskDescription });
        conversationHistory.push({ role: "assistant", content: finalAnswer });
        // Cap history to last 20 messages to avoid unbounded growth
        if (conversationHistory.length > 20) {
          conversationHistory.splice(0, conversationHistory.length - 20);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n${c.bold}❌ Task failed:${c.reset} ${message}\n`);

      if (
        message.includes("Sandbox") ||
        message.includes("sandbox") ||
        message.includes("E2B")
      ) {
        sessionInitialized = false;
        session = null;
      }
    }

    process.stdout.write(`\n${c.dim}${"─".repeat(50)}${c.reset}\n\n`);
  }
}
