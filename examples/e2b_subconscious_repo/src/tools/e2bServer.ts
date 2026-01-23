import { E2BSandbox, type SupportedLanguage } from "../e2b/sandbox";
import type { ExecutionResult } from "../types/agent";
import { verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * E2B Tool Server
 *
 * HTTP server that exposes E2B sandbox execution as a FunctionTool endpoint.
 * Subconscious calls this server when it needs to execute code.
 */

export interface E2BToolRequest {
  tool_name?: string;
  parameters?: {
    code: string;
    language?: SupportedLanguage;
    timeout?: number; // in seconds
  };
  request_id?: string;
}

export interface E2BToolResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  timeout?: boolean;
  error?: string;
}

let sandboxInstance: E2BSandbox | null = null;

function setSandboxInstance(sandbox: E2BSandbox) {
  sandboxInstance = sandbox;
}

export class E2BToolServer {
  private sandbox: E2BSandbox;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private port: number;
  private host: string;

  constructor(
    sandbox: E2BSandbox,
    port: number = 3001,
    host: string = "localhost"
  ) {
    this.sandbox = sandbox;
    this.port = port;
    this.host = host;
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<string> {
    if (this.server) {
      throw new Error("Server is already running");
    }

    await this.sandbox.initialize();
    setSandboxInstance(this.sandbox);

    this.server = Bun.serve({
      port: this.port,
      hostname: this.host,
      async fetch(req) {
        const url = new URL(req.url);
        const method = req.method;

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        if (method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        try {
          if (url.pathname === "/execute" && method === "POST") {
            return await handleExecute(req, corsHeaders);
          }

          if (url.pathname === "/health" && method === "GET") {
            return new Response(
              JSON.stringify({ status: "ok", service: "e2b-tool-server" }),
              {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          return new Response("Not Found", {
            status: 404,
            headers: corsHeaders,
          });
        } catch (error: any) {
          console.error(`[e2b-server] Error: ${error.message}`);
          return new Response(
            JSON.stringify({ error: error.message || "Internal server error" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    });

    const serverUrl = `http://${this.host}:${this.port}`;
    log(`[e2b-server] Server started on ${serverUrl}`);
    return serverUrl;
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
      log("[e2b-server] Server stopped");
    }
  }

  /**
   * Get the server URL.
   */
  getUrl(): string {
    if (!this.server) throw new Error("Server is not running");
    return `http://${this.host}:${this.port}`;
  }
}

async function handleExecute(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  if (!sandboxInstance) {
    return new Response(JSON.stringify({ error: "Sandbox not initialized" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json()) as E2BToolRequest;
  const params = body.parameters;

  if (!params?.code) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: code" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const code = params.code;
  const language = params.language || "python";
  const timeout = params.timeout ? params.timeout * 1000 : undefined;

  const codePreview = code.slice(0, 150).replace(/\n/g, "\\n");
  log(`[e2b-server] Executing ${language} code (request_id: ${body.request_id || "none"})`);
  log(`[e2b-server] Code: ${codePreview}${code.length > 150 ? "..." : ""}`);

  const startTime = Date.now();
  let result: ExecutionResult;

  try {
    result = await sandboxInstance.executeCode(code, language, timeout);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    log(`[e2b-server] Execution failed: ${error.message}`);

    const response: E2BToolResponse = {
      success: false,
      stdout: "",
      stderr: error.message || "Execution failed",
      exitCode: 1,
      duration,
      error: error.message,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  log(
    `[e2b-server] Result: success=${result.success}, exitCode=${result.exitCode}, duration=${result.duration}ms`
  );
  if (result.stdout) {
    log(
      `[e2b-server] stdout: ${result.stdout.slice(0, 200)}${result.stdout.length > 200 ? "..." : ""}`
    );
  }
  if (result.stderr) {
    log(
      `[e2b-server] stderr: ${result.stderr.slice(0, 200)}${result.stderr.length > 200 ? "..." : ""}`
    );
  }

  const response: E2BToolResponse = {
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    duration: result.duration || Date.now() - startTime,
    timeout: result.timeout,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
