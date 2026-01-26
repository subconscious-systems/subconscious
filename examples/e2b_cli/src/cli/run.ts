import * as readline from "readline";
import { Subconscious } from "subconscious";
import { E2BSandbox } from "../e2b/sandbox";
import { E2BToolServer } from "../tools/e2bServer";
import { setupTunnel, stopTunnel, type TunnelResult } from "../tools/tunnel";
import { runOnboarding, loadKeysIntoEnv } from "./onboarding";
import { loadConfig, verbose } from "../config";
import { getSessionManager, type Session } from "../session/manager";
import { validateTaskInputs, type ValidationResult } from "../utils/validation";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/** Spinner frames for loading animation */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** ANSI color codes for terminal output */
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

/** Simple loading spinner for setup phase */
class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    this.stop();
    process.stdout.write("\x1b[?25l"); // Hide cursor

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
      process.stdout.write("\r\x1b[K\x1b[?25h"); // Clear line and show cursor
    }
  }
}

/**
 * Extract thoughts from Subconscious streamed content.
 */
function extractThoughts(content: string): string[] {
  const thoughts: string[] = [];
  const thoughtPattern = /"thought"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = thoughtPattern.exec(content)) !== null) {
    try {
      const thought = match[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      if (thought.trim()) {
        thoughts.push(thought);
      }
    } catch {
      // Skip malformed thoughts
    }
  }

  return thoughts;
}

/**
 * Extract tool calls from Subconscious streamed content.
 */
function extractToolCalls(
  content: string
): Array<{ tool: string; args: Record<string, unknown> }> {
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const toolCallPattern =
    /"name"\s*:\s*"([^"]+)".*?"arguments"\s*:\s*(\{[^}]+\})/g;
  let match;

  while ((match = toolCallPattern.exec(content)) !== null) {
    try {
      const tool = match[1];
      const args = JSON.parse(match[2]);
      toolCalls.push({ tool, args });
    } catch {
      // Skip malformed tool calls
    }
  }

  return toolCalls;
}

/**
 * Extract the final answer from Subconscious response content.
 * Returns { finalAnswer, rawAnswer } where finalAnswer is the cleaned "Final_answer:" 
 * portion if found, otherwise null. rawAnswer is the full answer text.
 */
function extractFinalAnswer(content: string): { finalAnswer: string | null; rawAnswer: string | null } {
  const answerStart = content.indexOf('"answer"');
  if (answerStart === -1) return { finalAnswer: null, rawAnswer: null };

  const colonPos = content.indexOf(":", answerStart);
  if (colonPos === -1) return { finalAnswer: null, rawAnswer: null };

  let openQuote = content.indexOf('"', colonPos + 1);
  if (openQuote === -1) return { finalAnswer: null, rawAnswer: null };

  // Find closing quote (handle escaped quotes)
  let closeQuote = openQuote + 1;
  while (closeQuote < content.length) {
    if (content[closeQuote] === '"' && content[closeQuote - 1] !== "\\") {
      break;
    }
    closeQuote++;
  }

  if (closeQuote >= content.length) return { finalAnswer: null, rawAnswer: null };

  const rawAnswer = content.slice(openQuote + 1, closeQuote)
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\t/g, "\t");

  // Try to extract just the "Final_answer:" or "final_answer:" portion
  const finalAnswerPatterns = [
    /Final[_\s]?[Aa]nswer\s*:\s*([\s\S]*)/i,
    /final[_\s]?answer\s*:\s*([\s\S]*)/i,
  ];

  for (const pattern of finalAnswerPatterns) {
    const match = rawAnswer.match(pattern);
    if (match && match[1]?.trim()) {
      return { finalAnswer: match[1].trim(), rawAnswer };
    }
  }

  return { finalAnswer: null, rawAnswer };
}

/**
 * Build the tools array for the agent.
 */
function buildTools(tunnelUrl: string) {
  return [
    // Code execution tool
    {
      type: "function" as const,
      name: "execute_code",
      description:
        "Execute code in an isolated E2B sandbox. Supports Python, JavaScript, " +
        "TypeScript, C++, C, Go, Rust, Ruby, Java, and Bash. Returns stdout, " +
        "stderr, exit code, and duration. Files can be read/written at paths like " +
        "/home/user/input/ (for uploaded files) and /home/user/output/ (for generated files).",
      url: `${tunnelUrl}/execute`,
      method: "POST" as const,
      timeout: 300,
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Code to execute",
          },
          language: {
            type: "string",
            enum: [
              "python",
              "bash",
              "javascript",
              "typescript",
              "cpp",
              "c",
              "go",
              "rust",
              "ruby",
              "java",
            ],
            description: "Programming language. Use 'cpp' for C++. Default: python",
          },
          timeout: {
            type: "number",
            description: "Timeout in seconds (default: 300)",
          },
        },
        required: ["code"],
      },
    },
    // Upload file tool (local → sandbox)
    {
      type: "function" as const,
      name: "upload_local_file",
      description:
        "Upload a file from the user's local machine to the sandbox. Use this when " +
        "the user mentions a file path (like /Users/name/data.csv or ~/Desktop/file.txt) " +
        "that needs to be analyzed or processed. The file will be available in the sandbox " +
        "at the specified sandbox_path (defaults to /home/user/input/<filename>). " +
        "For multiple files, upload them one at a time.",
      url: `${tunnelUrl}/upload`,
      method: "POST" as const,
      timeout: 180,
      parameters: {
        type: "object",
        properties: {
          local_path: {
            type: "string",
            description:
              "Path to the file on the user's local machine. Supports absolute paths " +
              "(e.g., /Users/name/data.csv) and ~ for home directory (e.g., ~/Desktop/file.txt)",
          },
          sandbox_path: {
            type: "string",
            description:
              "Optional. Destination path in the sandbox. Defaults to /home/user/input/<filename>",
          },
        },
        required: ["local_path"],
      },
    },
    // Download file tool (sandbox → local)
    {
      type: "function" as const,
      name: "download_file",
      description:
        "Download a file from the sandbox to the user's local machine. Use this to save " +
        "outputs like charts, reports, processed data, etc. that the user wants to keep. " +
        "Call this after generating files in the sandbox that the user requested.",
      url: `${tunnelUrl}/download`,
      method: "POST" as const,
      timeout: 180,
      parameters: {
        type: "object",
        properties: {
          sandbox_path: {
            type: "string",
            description:
              "Path to the file in the sandbox (e.g., /home/user/output/chart.png)",
          },
          local_path: {
            type: "string",
            description:
              "Destination path on the user's local machine. Supports absolute paths " +
              "and ~ for home directory. Relative paths save to current working directory.",
          },
        },
        required: ["sandbox_path", "local_path"],
      },
    },
    // Check local file tool
    {
      type: "function" as const,
      name: "check_local_file",
      description:
        "Check if a file exists on the user's local machine and get its info. Use this " +
        "to verify file paths before attempting to upload them.",
      url: `${tunnelUrl}/check-file`,
      method: "POST" as const,
      timeout: 60,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to check on the user's local machine. Supports ~ for home directory.",
          },
        },
        required: ["path"],
      },
    },
  ];
}

/**
 * Build instructions for the agent based on user input.
 */
function buildInstructions(taskDescription: string, context?: string): string {
  let instructions = taskDescription;

  if (context) {
    instructions += `\n\nAdditional Context: ${context}`;
  }

  // Add guidance about file handling
  instructions += `

IMPORTANT - File Handling Instructions:
- If the user mentions any file paths (like /path/to/file.csv, ~/Desktop/data.txt, etc.), 
  use the upload_local_file tool to upload them to the sandbox BEFORE trying to read/process them.
- After uploading, the file will be available at the sandbox_path (usually /home/user/input/<filename>).
- When you create output files (charts, reports, processed data), save them to /home/user/output/.
- If the user asks to save/create/output a file, use download_file to save it to their local machine 
  after generating it in the sandbox.
- For charts/images, use matplotlib with: import matplotlib; matplotlib.use('Agg') before importing pyplot.`;

  return instructions;
}

/**
 * Display validation results to the user.
 */
function displayValidationResult(validation: ValidationResult, c: typeof COLORS): boolean {
  if (validation.warnings.length > 0) {
    for (const warning of validation.warnings) {
      console.log(`${c.yellow}⚠ Warning:${c.reset} ${warning}`);
    }
  }

  if (!validation.valid) {
    console.log(`\n${c.red}${c.bold}✗ Validation failed:${c.reset}`);
    for (const error of validation.errors) {
      console.log(`  ${c.red}•${c.reset} ${error}`);
    }
    console.log();
    return false;
  }

  return true;
}

/**
 * Run agent with provided task and context (non-interactive).
 * Used for testing and programmatic access.
 * This version creates a fresh sandbox for each call (no session reuse).
 */
export async function runAgentWithTask(
  taskDescription: string,
  context?: string
): Promise<void> {
  // Load any saved keys
  await loadKeysIntoEnv();
  
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SUBCONSCIOUS_API_KEY environment variable is not set. " +
        "Get your API key at: https://www.subconscious.dev/platform"
    );
  }

  const config = await loadConfig();

  // Validate input before starting
  const validation = await validateTaskInputs(taskDescription, config.validation);
  if (!displayValidationResult(validation, COLORS)) {
    throw new Error("Input validation failed");
  }

  const sandbox = new E2BSandbox(config);
  const toolServer = new E2BToolServer(
    sandbox,
    config.tools.port,
    config.tools.host
  );
  let tunnelResult: TunnelResult | null = null;

  const spinner = new Spinner("Initializing sandbox...");
  spinner.start();

  try {
    await sandbox.initialize();

    // Start tool server
    spinner.update("Starting tool server...");
    const localUrl = await toolServer.start();
    log(`[server] Tool server running at ${localUrl}`);

    // Setup tunnel
    spinner.update("Setting up tunnel...");
    try {
      tunnelResult = await setupTunnel(localUrl, config.tunnel);
      log(`[tunnel] Using tunnel: ${tunnelResult.url}`);
    } catch (error: any) {
      spinner.stop();
      console.error(`[tunnel] ${error.message}`);
      throw error;
    }

    // Verify local server
    spinner.update("Verifying server connectivity...");
    log("[server] Verifying local server...");
    try {
      const localHealthResponse = await fetch(`${localUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (localHealthResponse.ok) {
        log("[server] ✓ Local server responding");
      }
    } catch (error: any) {
      spinner.stop();
      console.error(`[server] ✗ Local server not responding: ${error.message}`);
      throw new Error("Local tool server is not responding");
    }

    // Quick tunnel check
    spinner.update("Checking tunnel connectivity...");
    log("[tunnel] Quick connectivity check...");
    await new Promise((r) => setTimeout(r, 1000));

    try {
      const healthUrl = `${tunnelResult.url}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        log("[tunnel] ✓ Tunnel verified");
      }
    } catch {
      log("[tunnel] Local check failed (normal - Subconscious uses different route)");
    }

    // Build tools and instructions
    const tools = buildTools(tunnelResult.url);
    const instructions = buildInstructions(taskDescription, context);

    const client = new Subconscious({ apiKey });

    spinner.stop();
    console.log("\x1b[32m✓\x1b[0m Setup complete\n");
    console.log("[agent] Starting Subconscious agent...\n");
    console.log("=".repeat(60) + "\n");

    // Stream Subconscious events
    const stream = client.stream({
      engine: "tim-gpt",
      input: {
        instructions,
        tools: tools as any,
      },
    });

    let fullContent = "";
    const displayedThoughts: string[] = [];
    const displayedToolCalls: string[] = [];

    for await (const event of stream) {
      if (event.type === "delta") {
        fullContent += event.content;

        // Extract and display new thoughts
        const thoughts = extractThoughts(fullContent);
        for (const thought of thoughts) {
          if (!displayedThoughts.includes(thought)) {
            console.log(`💭 ${thought}\n`);
            displayedThoughts.push(thought);
          }
        }

        // Extract and display tool calls
        const toolCalls = extractToolCalls(fullContent);
        for (const tc of toolCalls) {
          const key = `${tc.tool}:${JSON.stringify(tc.args)}`;
          if (!displayedToolCalls.includes(key)) {
            if (tc.tool === "execute_code" && tc.args.code) {
              const codeStr = String(tc.args.code);
              const codePreview =
                codeStr.slice(0, 100) + (codeStr.length > 100 ? "..." : "");
              console.log(`🔧 Executing code: ${codePreview}\n`);
            } else if (tc.tool === "upload_local_file") {
              console.log(`📤 Uploading: ${tc.args.local_path}\n`);
            } else if (tc.tool === "download_file") {
              console.log(`📥 Downloading: ${tc.args.sandbox_path} → ${tc.args.local_path}\n`);
            } else if (tc.tool === "check_local_file") {
              console.log(`🔍 Checking file: ${tc.args.path}\n`);
            } else {
              console.log(`🔧 Calling tool: ${tc.tool}\n`);
            }
            displayedToolCalls.push(key);
          }
        }
      } else if (event.type === "done") {
        console.log("\n" + "=".repeat(60));
        console.log("[agent] Agent completed\n");

        const { finalAnswer, rawAnswer } = extractFinalAnswer(fullContent);
        if (finalAnswer) {
          // Show just the clean final answer
          console.log(`${COLORS.magenta}${COLORS.bold}📋 Final Answer:${COLORS.reset}\n`);
          console.log(`${COLORS.cyan}${finalAnswer}${COLORS.reset}\n`);
        } else if (rawAnswer?.trim()) {
          // Fallback: show the full raw answer
          console.log(`${COLORS.magenta}${COLORS.bold}📋 Final Answer:${COLORS.reset}\n`);
          console.log(`${COLORS.cyan}${rawAnswer}${COLORS.reset}\n`);
        } else {
          console.log(`${COLORS.magenta}${COLORS.bold}📋 Response received${COLORS.reset}\n`);
        }

        break;
      } else if (event.type === "error") {
        console.error(`\n❌ Error: ${event.message}`);
        if (event.code) {
          console.error(`   Code: ${event.code}`);
        }
        throw new Error(event.message);
      }
    }

    log("\n[done] Agent finished");
  } catch (error: any) {
    spinner.stop();
    console.error("\n❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  } finally {
    if (tunnelResult) {
      stopTunnel(tunnelResult);
    }
    await toolServer.stop();
    await sandbox.cleanup();
  }
}

/**
 * Run a task with an existing session (for session persistence).
 */
async function runTaskWithSession(
  session: Session,
  taskDescription: string,
  context?: string
): Promise<void> {
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    throw new Error("SUBCONSCIOUS_API_KEY environment variable is not set.");
  }

  // Mark session as active
  const sessionManager = getSessionManager();
  sessionManager.markActive();

  // Build tools and instructions
  const tools = buildTools(session.tunnelUrl);
  const instructions = buildInstructions(taskDescription, context);

  const client = new Subconscious({ apiKey });

  console.log("[agent] Starting Subconscious agent...\n");
  console.log("=".repeat(60) + "\n");

  // Stream Subconscious events
  const stream = client.stream({
    engine: "tim-gpt",
    input: {
      instructions,
      tools: tools as any,
    },
  });

  let fullContent = "";
  const displayedThoughts: string[] = [];
  const displayedToolCalls: string[] = [];

  for await (const event of stream) {
    if (event.type === "delta") {
      fullContent += event.content;

      // Extract and display new thoughts
      const thoughts = extractThoughts(fullContent);
      for (const thought of thoughts) {
        if (!displayedThoughts.includes(thought)) {
          console.log(`💭 ${thought}\n`);
          displayedThoughts.push(thought);
        }
      }

      // Extract and display tool calls
      const toolCalls = extractToolCalls(fullContent);
      for (const tc of toolCalls) {
        const key = `${tc.tool}:${JSON.stringify(tc.args)}`;
        if (!displayedToolCalls.includes(key)) {
          if (tc.tool === "execute_code" && tc.args.code) {
            const codeStr = String(tc.args.code);
            const codePreview =
              codeStr.slice(0, 100) + (codeStr.length > 100 ? "..." : "");
            console.log(`🔧 Executing code: ${codePreview}\n`);
          } else if (tc.tool === "upload_local_file") {
            console.log(`📤 Uploading: ${tc.args.local_path}\n`);
          } else if (tc.tool === "download_file") {
            console.log(`📥 Downloading: ${tc.args.sandbox_path} → ${tc.args.local_path}\n`);
          } else if (tc.tool === "check_local_file") {
            console.log(`🔍 Checking file: ${tc.args.path}\n`);
          } else {
            console.log(`🔧 Calling tool: ${tc.tool}\n`);
          }
          displayedToolCalls.push(key);
        }
      }
    } else if (event.type === "done") {
      console.log("\n" + "=".repeat(60));
      console.log("[agent] Agent completed\n");

      const { finalAnswer, rawAnswer } = extractFinalAnswer(fullContent);
      if (finalAnswer) {
        console.log(`${COLORS.magenta}${COLORS.bold}📋 Final Answer:${COLORS.reset}\n`);
        console.log(`${COLORS.cyan}${finalAnswer}${COLORS.reset}\n`);
      } else if (rawAnswer?.trim()) {
        console.log(`${COLORS.magenta}${COLORS.bold}📋 Final Answer:${COLORS.reset}\n`);
        console.log(`${COLORS.cyan}${rawAnswer}${COLORS.reset}\n`);
      } else {
        console.log(`${COLORS.magenta}${COLORS.bold}📋 Response received${COLORS.reset}\n`);
      }

      break;
    } else if (event.type === "error") {
      console.error(`\n❌ Error: ${event.message}`);
      if (event.code) {
        console.error(`   Code: ${event.code}`);
      }
      throw new Error(event.message);
    }
  }

  log("\n[done] Agent finished");
}

/**
 * Interactive CLI entrypoint with command history support and session persistence.
 */
export async function runAgent(): Promise<void> {
  // Load any saved keys from ~/.subcon/config.json
  await loadKeysIntoEnv();

  // Check if keys are set, run onboarding if not
  if (!process.env.SUBCONSCIOUS_API_KEY || !process.env.E2B_API_KEY) {
    const success = await runOnboarding();
    if (!success) {
      process.exit(1);
    }
  }

  const config = await loadConfig();
  const sessionManager = getSessionManager();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  const history: string[] = [];
  const c = COLORS;

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      (rl as any).history = [...history];
      rl.question(prompt, (answer) => {
        const trimmed = answer.trim();
        if (trimmed && !history.includes(trimmed)) {
          history.unshift(trimmed);
          if (history.length > 100) history.pop();
        }
        resolve(trimmed);
      });
    });
  };

  // ASCII art intro
  console.log(`
${c.cyan}${c.bold}  ┌─┐┬ ┬┌┐ ┌─┐┌─┐┌┐┌┌─┐┌─┐┬┌─┐┬ ┬┌─┐
  └─┐│ │├┴┐│  │ ││││└─┐│  ││ ││ │└─┐
  └─┘└─┘└─┘└─┘└─┘┘└┘└─┘└─┘┴└─┘└─┘└─┘${c.reset}  ${c.dim}+ E2B Sandbox${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}

  ${c.green}▸${c.reset} ${c.bold}Powered by${c.reset}
    ${c.cyan}Subconscious${c.reset} ${c.dim}─${c.reset} Long-horizon reasoning & tool orchestration
    ${c.yellow}E2B Sandbox${c.reset}  ${c.dim}─${c.reset} Secure cloud code execution

  ${c.green}▸${c.reset} ${c.bold}What You Can Do${c.reset}
    ${c.dim}•${c.reset} Reference local files naturally: ${c.cyan}~/Desktop/data.csv${c.reset}
    ${c.dim}•${c.reset} Ask for outputs: ${c.cyan}"save a chart to chart.png"${c.reset}
    ${c.dim}•${c.reset} The AI will handle file uploads and downloads automatically

  ${c.green}▸${c.reset} ${c.bold}Commands${c.reset}
    ${c.dim}•${c.reset} ${c.white}reset${c.reset}  ${c.dim}─${c.reset} Reset the sandbox session
    ${c.dim}•${c.reset} ${c.white}status${c.reset} ${c.dim}─${c.reset} Show session status
    ${c.dim}•${c.reset} ${c.white}clear${c.reset}  ${c.dim}─${c.reset} Clear the screen
    ${c.dim}•${c.reset} ${c.white}exit${c.reset}   ${c.dim}─${c.reset} Exit the CLI

  ${c.green}▸${c.reset} ${c.bold}Example${c.reset}
    ${c.dim}"Analyze ~/Desktop/sales.csv and create a bar chart, save it to chart.png"${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}
`);

  // Handle cleanup on exit
  const cleanup = async () => {
    console.log(`\n${c.dim}Cleaning up...${c.reset}`);
    await sessionManager.cleanup();
    rl.close();
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  // REPL loop with session persistence
  let session: Session | null = null;
  let sessionInitialized = false;

  while (true) {
    const taskDescription = await question(
      `${c.green}${c.bold}▸${c.reset} ${c.bold}Task${c.reset} ${c.dim}›${c.reset} `
    );

    // Handle exit
    if (
      !taskDescription ||
      taskDescription.toLowerCase() === "exit" ||
      taskDescription.toLowerCase() === "quit"
    ) {
      console.log(`\n${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
      console.log(`${c.cyan}${c.bold}  👋 Until next time!${c.reset}`);
      console.log(`${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`);
      await cleanup();
      break;
    }

    // Handle clear command
    if (taskDescription.toLowerCase() === "clear") {
      process.stdout.write("\x1b[2J\x1b[H");
      continue;
    }

    // Handle reset command
    if (taskDescription.toLowerCase() === "reset") {
      console.log(`${c.yellow}Resetting session...${c.reset}`);
      try {
        session = await sessionManager.reset();
        console.log(`${c.green}✓ Session reset successfully${c.reset}\n`);
      } catch (error: any) {
        console.error(`${c.red}✗ Failed to reset session: ${error.message}${c.reset}\n`);
      }
      continue;
    }

    // Handle status command
    if (taskDescription.toLowerCase() === "status") {
      const status = sessionManager.getStatus();
      console.log(`\n${c.bold}Session Status:${c.reset}`);
      console.log(`  ${c.dim}Active:${c.reset} ${status.active ? c.green + "Yes" : c.yellow + "No"}${c.reset}`);
      if (status.active) {
        console.log(`  ${c.dim}Sandbox ID:${c.reset} ${status.sandboxId?.slice(0, 12)}...`);
        console.log(`  ${c.dim}Tunnel:${c.reset} ${status.tunnelUrl}`);
        const healthStr = status.tunnelHealthy ? c.green + "Yes" : c.red + "No";
        console.log(`  ${c.dim}Tunnel Healthy:${c.reset} ${healthStr}${c.reset}`);
        console.log(`  ${c.dim}Idle Time:${c.reset} ${Math.round((status.idleTimeMs || 0) / 1000)}s`);
        console.log(`  ${c.dim}Total Duration:${c.reset} ${Math.round((status.totalDurationMs || 0) / 1000)}s`);
      }
      console.log();
      continue;
    }

    // Validate input before proceeding
    const validation = await validateTaskInputs(taskDescription, config.validation);
    if (!displayValidationResult(validation, c)) {
      continue;
    }

    const contextInput = await question(
      `${c.blue}${c.bold}▸${c.reset} ${c.bold}Context${c.reset} ${c.dim}(optional)${c.reset} ${c.dim}›${c.reset} `
    );

    try {
      // Initialize or get session
      if (!sessionInitialized || !session) {
        const spinner = new Spinner("Initializing session...");
        spinner.start();
        try {
          session = await sessionManager.getOrCreateSession();
          sessionInitialized = true;
          spinner.stop();
          console.log(`${c.green}✓${c.reset} Session ready\n`);
        } catch (error: any) {
          spinner.stop();
          throw error;
        }
      }

      // Run task with session
      await runTaskWithSession(session, taskDescription, contextInput);
    } catch (error: any) {
      console.error(`\n${c.bold}❌ Task failed:${c.reset} ${error.message}\n`);
      
      // If session failed, mark as needing reinitialization
      if (error.message.includes("Sandbox") || error.message.includes("tunnel")) {
        sessionInitialized = false;
        session = null;
      }
    }

    console.log(`\n${c.dim}${"─".repeat(50)}${c.reset}\n`);
  }
}
