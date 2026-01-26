import * as readline from "readline";
import { Subconscious } from "subconscious";
import { E2BSandbox } from "../e2b/sandbox";
import { E2BToolServer } from "../tools/e2bServer";
import { setupTunnel, stopTunnel, type TunnelResult } from "../tools/tunnel";
import { parseFileReferences } from "./fileParser";
import { loadConfig, verbose } from "../config";
import type { AgentTask } from "../types/agent";

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
 * Run agent with provided task and context (non-interactive).
 * Used for testing and programmatic access.
 */
export async function runAgentWithTask(
  taskDescription: string,
  context?: string
): Promise<void> {
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SUBCONSCIOUS_API_KEY environment variable is not set. " +
        "Get your API key at: https://www.subconscious.dev/platform"
    );
  }

  const config = await loadConfig();

  // Parse file references from task description and context
  const fileParseResult = await parseFileReferences(
    taskDescription,
    context || undefined
  );

  if (fileParseResult.files.length > 0) {
    console.log(
      `[file] Parsed ${fileParseResult.files.length} file reference(s):`
    );
    for (const f of fileParseResult.files) {
      console.log(`  ${f.type}: ${f.localPath} → ${f.sandboxPath}`);
    }
  }

  // Collect environment variables (filter sensitive ones)
  const envVars: Record<string, string> = {};
  if (config.environment.filterSensitive) {
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value &&
        !config.environment.sensitivePatterns.some((pattern: string) =>
          key.toUpperCase().includes(pattern.toUpperCase())
        )
      ) {
        envVars[key] = value;
      }
    }
  } else {
    for (const [key, value] of Object.entries(process.env)) {
      if (value) {
        envVars[key] = value;
      }
    }
  }

  const task: AgentTask = {
    description: fileParseResult.updatedDescription,
    context: context || undefined,
    files: fileParseResult.files,
    environmentVariables: Object.keys(envVars).length > 0 ? envVars : undefined,
  };

  const sandbox = new E2BSandbox();
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

    // Upload input files to sandbox
    if (task.files && task.files.length > 0) {
      const inputFiles = task.files.filter((f) => f.type === "input");
      if (inputFiles.length > 0) {
        spinner.update(`Uploading ${inputFiles.length} file(s)...`);
        log(`[file] Uploading ${inputFiles.length} file(s)...`);
        for (const file of inputFiles) {
          try {
            await sandbox.uploadFile(file.localPath, file.sandboxPath);
          } catch (error: any) {
            spinner.stop();
            console.error(
              `[file] Failed to upload ${file.localPath}: ${error.message}`
            );
            throw error;
          }
        }
        log(`[file] Upload complete\n`);
      }
    }

    // Set environment variables in sandbox
    if (task.environmentVariables) {
      await sandbox.setEnvironmentVariables(task.environmentVariables);
    }

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

    // Build instructions for Subconscious
    let instructions = task.description;
    if (task.context) {
      instructions += `\n\nContext: ${task.context}`;
    }

    // Add file context
    if (task.files && task.files.length > 0) {
      const inputFiles = task.files.filter((f) => f.type === "input");
      const outputFiles = task.files.filter((f) => f.type === "output");

      if (inputFiles.length > 0) {
        const inputList = inputFiles
          .map((f) => `- ${f.sandboxPath}`)
          .join("\n");
        instructions += `\n\nInput files (already uploaded to sandbox):\n${inputList}`;
      }

      if (outputFiles.length > 0) {
        const outputList = outputFiles
          .map((f) => `- Save to: ${f.sandboxPath}`)
          .join("\n");
        instructions += `\n\nOUTPUT FILES - Save to these EXACT paths:\n${outputList}`;
        instructions +=
          "\n\nIMPORTANT: Use these exact sandbox paths. " +
          "For images use plt.savefig(), for text/JSON use open() with write mode.";
      }
    }

    // Register FunctionTool with multi-language support
    const e2bTool = {
      type: "function" as const,
      name: "execute_code",
      description:
        "Execute code in an isolated E2B sandbox. Supports Python, JavaScript, " +
        "TypeScript, C++, C, Go, Rust, Ruby, Java, and Bash. Returns stdout, " +
        "stderr, exit code, and duration.",
      url: `${tunnelResult.url}/execute`,
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
    };

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
        tools: [e2bTool] as any,
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
            console.log(`🔧 Calling tool: ${tc.tool}`);
            if (tc.tool === "execute_code" && tc.args.code) {
              const codeStr = String(tc.args.code);
              const codePreview =
                codeStr.slice(0, 100) + (codeStr.length > 100 ? "..." : "");
              console.log(`   Code: ${codePreview}\n`);
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

    // Download output files from sandbox
    if (task.files && task.files.length > 0) {
      const outputFiles = task.files.filter((f) => f.type === "output");
      if (outputFiles.length > 0) {
        console.log(
          `\n[file] Downloading ${outputFiles.length} output file(s)...`
        );
        let downloadedCount = 0;
        for (const file of outputFiles) {
          try {
            const files = await sandbox.listFiles("/home/user/output");
            const fileExists = files.some(
              (f: any) => f.name === file.sandboxPath.split("/").pop()
            );

            if (fileExists) {
              await sandbox.downloadFile(file.sandboxPath, file.localPath);
              downloadedCount++;
              console.log(`[file] ✓ Downloaded: ${file.localPath}`);
            } else {
              console.log(
                `[file] ⚠ Output file not found in sandbox: ${file.sandboxPath}`
              );
            }
          } catch (error: any) {
            console.error(
              `[file] ✗ Failed to download ${file.sandboxPath}: ${error.message}`
            );
          }
        }
        if (downloadedCount > 0) {
          console.log(`[file] ✓ ${downloadedCount} file(s) saved successfully`);
        }
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
    if (tunnelResult?.process) {
      stopTunnel(tunnelResult.process);
    }
    await toolServer.stop();
    await sandbox.cleanup();
  }
}

/**
 * Interactive CLI entrypoint with command history support.
 */
export async function runAgent(): Promise<void> {
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    console.error(
      "❌ Error: SUBCONSCIOUS_API_KEY environment variable is not set"
    );
    console.error("   Get your API key at: https://www.subconscious.dev/platform");
    process.exit(1);
  }

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

  ${c.green}▸${c.reset} ${c.bold}Quick Tips${c.reset}
    ${c.dim}•${c.reset} Include ${c.cyan}file: ./data.csv${c.reset} in your task to upload a file
    ${c.dim}•${c.reset} Include ${c.cyan}output: ./result.json${c.reset} to download output when done
    ${c.dim}•${c.reset} Add details in the optional ${c.white}Context${c.reset} prompt
    ${c.dim}•${c.reset} Type ${c.white}exit${c.reset} to quit

  ${c.green}▸${c.reset} ${c.bold}Example${c.reset}
    ${c.dim}"Analyze file: ./sales.csv and save a chart to output: ./chart.png"${c.reset}

${c.dim}──────────────────────────────────────────────────${c.reset}
`);

  // REPL loop
  while (true) {
    const taskDescription = await question(
      `${c.green}${c.bold}▸${c.reset} ${c.bold}Task${c.reset} ${c.dim}›${c.reset} `
    );

    if (
      !taskDescription ||
      taskDescription.toLowerCase() === "exit" ||
      taskDescription.toLowerCase() === "quit"
    ) {
      console.log(`\n${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
      console.log(`${c.cyan}${c.bold}  👋 Until next time!${c.reset}`);
      console.log(`${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`);
      break;
    }

    const contextInput = await question(
      `${c.blue}${c.bold}▸${c.reset} ${c.bold}Context${c.reset} ${c.dim}(optional)${c.reset} ${c.dim}›${c.reset} `
    );

    try {
      await runAgentWithTask(taskDescription, contextInput);
    } catch (error: any) {
      console.error(`\n${c.bold}❌ Task failed:${c.reset} ${error.message}\n`);
    }

    console.log(`\n${c.dim}${"─".repeat(50)}${c.reset}\n`);
  }

  rl.close();
}
