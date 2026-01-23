import * as readline from "readline";
import { Subconscious } from "subconscious";
import { E2BSandbox } from "../e2b/sandbox";
import { E2BToolServer } from "../tools/e2bServer";
import { setupTunnel, stopTunnel, type TunnelResult } from "../tools/tunnel";
import { parseFileReferences } from "./fileParser";
import { loadConfig, verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}
import type { AgentTask } from "../types/agent";

/**
 * CLI Entrypoint: Subconscious-Orchestrated Agent
 * 
 * Design: Subconscious handles all reasoning and tool orchestration
 * - User provides task
 * - Subconscious streams reasoning and tool calls
 * - E2B execution happens via FunctionTool HTTP endpoint
 * - Subconscious continues based on tool results
 */

/**
 * Extract tool calls from streamed content.
 * Pattern matching similar to school_scheduler implementation.
 */
function extractToolCalls(
  content: string
): Array<{ tool: string; args: Record<string, unknown> }> {
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  // Look for tool call patterns in the content
  // Pattern: "name": "...", "arguments": {...}
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
 * Extract thoughts from streamed content.
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
 * Run agent with provided task and context (non-interactive).
 * Used for testing and programmatic access.
 */
export async function runAgentWithTask(
  taskDescription: string,
  context?: string
): Promise<void> {
  // Check for required environment variables
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SUBCONSCIOUS_API_KEY environment variable is not set. " +
        "Get your API key at: https://www.subconscious.dev/platform"
    );
  }

  // Load configuration
  const config = await loadConfig();

  // Parse file references from task description and context
  const fileParseResult = await parseFileReferences(
    taskDescription,
    context || undefined
  );

  // Collect environment variables from .env (filter sensitive ones)
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
    // Include all env vars if filtering is disabled
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

  // Initialize components
  const sandbox = new E2BSandbox();
  const toolServer = new E2BToolServer(
    sandbox,
    config.tools.port,
    config.tools.host
  );
  let tunnelResult: TunnelResult | null = null;

  try {
    // Initialize E2B sandbox
    await sandbox.initialize();

    // Upload input files to sandbox
    if (task.files && task.files.length > 0) {
      const inputFiles = task.files.filter((f) => f.type === "input");
      if (inputFiles.length > 0) {
        log(`[file] Uploading ${inputFiles.length} file(s)...`);
        for (const file of inputFiles) {
          try {
            await sandbox.uploadFile(file.localPath, file.sandboxPath);
          } catch (error: any) {
            console.error(`[file] Failed to upload ${file.localPath}: ${error.message}`);
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
    const localUrl = await toolServer.start();
    log(`[server] Tool server running at ${localUrl}`);

    // Setup tunnel
    try {
      tunnelResult = await setupTunnel(localUrl, config.tunnel);
      log(`[tunnel] Using tunnel: ${tunnelResult.url}`);
    } catch (error: any) {
      console.error(`[tunnel] ${error.message}`);
      throw error;
    }

    // First verify local server is responding
    log("[server] Verifying local server...");
    try {
      const localHealthResponse = await fetch(`${localUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (localHealthResponse.ok) {
        log("[server] ✓ Local server responding");
      }
    } catch (error: any) {
      console.error(`[server] ✗ Local server not responding: ${error.message}`);
      throw new Error("Local tool server is not responding");
    }

    // Quick tunnel check - Subconscious calls from their servers, so local verification
    // often fails even when the tunnel works. Do a quick check but proceed regardless.
    log("[tunnel] Quick connectivity check...");
    await new Promise((r) => setTimeout(r, 1000)); // Brief pause for DNS
    
    let tunnelVerified = false;
    try {
      const healthUrl = `${tunnelResult.url}/health`;
      const response = await fetch(healthUrl, { 
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        log("[tunnel] ✓ Tunnel verified");
        tunnelVerified = true;
      }
    } catch {
      // Local verification often fails, but Subconscious can still reach the tunnel
      log("[tunnel] Local check failed (normal - Subconscious uses different route)");
    }

    // Build instructions for Subconscious
    let instructions = task.description;
    if (task.context) {
      instructions += `\n\nContext: ${task.context}`;
    }

    // Add file context if files were uploaded
    if (task.files && task.files.length > 0) {
      const fileList = task.files
        .filter((f) => f.type === "input")
        .map((f) => `- ${f.sandboxPath} (from ${f.localPath})`)
        .join("\n");
      instructions += `\n\nUploaded files:\n${fileList}`;
    }

    // Register FunctionTool with multi-language support
    const e2bTool = {
      type: "function" as const,
      name: "execute_code",
      description:
        "Execute code in an isolated E2B sandbox. Supports Python, JavaScript, TypeScript, " +
        "C++, C, Go, Rust, Ruby, Java, and Bash. Compiled languages (C++, C, Rust, Java) " +
        "are automatically compiled before execution. Returns stdout, stderr, exit code, and duration.",
      url: `${tunnelResult.url}/execute`,
      method: "POST" as const,
      timeout: 300, // 5 minutes
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Code to execute",
          },
          language: {
            type: "string",
            enum: ["python", "bash", "javascript", "typescript", "cpp", "c", "go", "rust", "ruby", "java"],
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

    // Initialize Subconscious client
    const client = new Subconscious({ apiKey });

    console.log("[agent] Starting Subconscious agent...\n");
    console.log("=".repeat(60) + "\n");

    // Stream Subconscious events
    const stream = client.stream({
      engine: "tim-gpt",
      input: {
        instructions,
        // Type assertion needed for FunctionTool with URL
        tools: [e2bTool] as any,
      },
    });

    let fullContent = "";
    let lastSentThoughts: string[] = [];
    let lastSentToolCalls: string[] = [];
    let answerStarted = false;

    for await (const event of stream) {
      if (event.type === "delta") {
        fullContent += event.content;

        // Extract and display new thoughts
        const thoughts = extractThoughts(fullContent);
        const newThoughts = thoughts.filter(
          (t) => !lastSentThoughts.includes(t)
        );

        for (const thought of newThoughts) {
          console.log(`💭 ${thought}\n`);
          lastSentThoughts.push(thought);
        }

        // Extract and display tool calls
        const toolCalls = extractToolCalls(fullContent);
        for (const tc of toolCalls) {
          const key = `${tc.tool}:${JSON.stringify(tc.args)}`;
          if (!lastSentToolCalls.includes(key)) {
            console.log(`🔧 Calling tool: ${tc.tool}`);
            if (tc.tool === "execute_code" && tc.args.code) {
              const codePreview =
                typeof tc.args.code === "string"
                  ? tc.args.code.slice(0, 100) +
                    (tc.args.code.length > 100 ? "..." : "")
                  : String(tc.args.code);
              console.log(`   Code: ${codePreview}\n`);
            }
            lastSentToolCalls.push(key);
          }
        }

        // Extract and display answer as it streams
        try {
          const jsonMatch = fullContent.match(/"answer"\s*:\s*"([^"]*)"/);
          if (jsonMatch) {
            const answerText = jsonMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\");

            if (answerText && !answerStarted) {
              console.log("\n📋 Answer:\n");
              answerStarted = true;
            }

            // Display new answer content (simple approach - could be improved)
            if (answerStarted) {
              // For now, we'll display the full answer at the end
              // Real-time answer streaming would require more sophisticated parsing
            }
          }
        } catch {
          // Ignore parse errors during streaming
        }
      } else if (event.type === "done") {
        console.log("\n" + "=".repeat(60));
        console.log("[agent] Agent completed\n");

        // Try to extract final answer - handle escaped quotes properly
        try {
          // Look for "answer": " and then capture everything until unescaped "
          const answerStart = fullContent.indexOf('"answer"');
          if (answerStart !== -1) {
            // Find the colon and opening quote
            const colonPos = fullContent.indexOf(':', answerStart);
            if (colonPos !== -1) {
              // Find opening quote after colon
              let openQuote = fullContent.indexOf('"', colonPos + 1);
              if (openQuote !== -1) {
                // Find closing quote (handle escaped quotes)
                let closeQuote = openQuote + 1;
                while (closeQuote < fullContent.length) {
                  if (fullContent[closeQuote] === '"' && fullContent[closeQuote - 1] !== '\\') {
                    break;
                  }
                  closeQuote++;
                }
                
                if (closeQuote < fullContent.length) {
                  const rawAnswer = fullContent.slice(openQuote + 1, closeQuote);
                  const answer = rawAnswer
                    .replace(/\\n/g, "\n")
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, "\\")
                    .replace(/\\t/g, "\t");
                  
                  if (answer.trim()) {
                    console.log("📋 Final Answer:\n");
                    console.log(answer + "\n");
                  }
                }
              }
            }
          }
        } catch {
          // If answer extraction fails, show raw content
          console.log("📋 Response received\n");
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
        console.log(`\n[file] Downloading ${outputFiles.length} output file(s)...`);
        let downloadedCount = 0;
        for (const file of outputFiles) {
          try {
            // Check if file exists in sandbox before downloading
            const files = await sandbox.listFiles("/home/user/output");
            const fileExists = files.some(
              (f: any) => f.name === file.sandboxPath.split("/").pop()
            );

            if (fileExists) {
              await sandbox.downloadFile(file.sandboxPath, file.localPath);
              downloadedCount++;
              log(`[file] ✓ Downloaded: ${file.localPath}`);
            } else {
              log(`[file] ⚠ Output file not found in sandbox: ${file.sandboxPath}`);
            }
          } catch (error: any) {
            console.error(`[file] ✗ Failed to download ${file.sandboxPath}: ${error.message}`);
          }
        }
        if (downloadedCount > 0) {
          log(`[file] Downloaded ${downloadedCount} file(s) successfully`);
        }
      }
    }

    log("\n[done] Agent finished");
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  } finally {
    // Cleanup
    if (tunnelResult?.process) {
      stopTunnel(tunnelResult.process);
    }
    await toolServer.stop();
    await sandbox.cleanup();
  }
}

/**
 * Interactive CLI entrypoint.
 */
export async function runAgent(): Promise<void> {
  // Check for required environment variables
  const apiKey = process.env.SUBCONSCIOUS_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: SUBCONSCIOUS_API_KEY environment variable is not set");
    console.error("   Get your API key at: https://www.subconscious.dev/platform");
    process.exit(1);
  }

  // Setup readline for interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  // Welcome message
  console.log("\n🤖 CLI Agent (Subconscious + E2B)");
  console.log("==================================\n");
  console.log("This agent uses:");
  console.log("  • Subconscious = reasoning & tool orchestration");
  console.log("  • E2B = code execution environment (via FunctionTool)");
  console.log("\nTip: Use 'file: ./path' to upload files, 'output: ./path' to specify output files\n");

  // Get task from user
  const taskDescription = await question("Enter task: ");
  if (!taskDescription) {
    console.error("❌ Task description is required");
    rl.close();
    process.exit(1);
  }

  const contextInput = await question("Context (optional, press Enter to skip): ");
  rl.close();

  // Call the non-interactive version
  await runAgentWithTask(taskDescription, contextInput);
}
