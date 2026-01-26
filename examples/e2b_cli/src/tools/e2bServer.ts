import { E2BSandbox, type SupportedLanguage } from "../e2b/sandbox";
import type { ExecutionResult } from "../types/agent";
import { verbose, defaultConfig } from "../config";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import {
  sanitizeSandboxPath,
  validateSandboxPath,
  type ValidationConfig,
} from "../utils/validation";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * E2B Tool Server
 *
 * HTTP server that exposes E2B sandbox tools as FunctionTool endpoints.
 * Subconscious calls these endpoints when it needs to:
 * - Execute code in the sandbox
 * - Upload files from user's machine to the sandbox
 * - Download files from the sandbox to user's machine
 * - Check if local files exist
 *
 * Includes path sanitization for security.
 */

export interface E2BToolRequest {
  tool_name?: string;
  parameters?: Record<string, unknown>;
  request_id?: string;
}

export interface E2BToolResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
  timeout?: boolean;
  error?: string;
  message?: string;
  exists?: boolean;
  size?: number;
  is_file?: boolean;
  is_directory?: boolean;
  sandbox_path?: string;
  local_path?: string;
  path_sanitized?: boolean;
}

let sandboxInstance: E2BSandbox | null = null;
let validationConfig: ValidationConfig = defaultConfig.validation;

function setSandboxInstance(sandbox: E2BSandbox) {
  sandboxInstance = sandbox;
}

function setValidationConfig(config: ValidationConfig) {
  validationConfig = config;
}

/** Expand ~ to home directory */
function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export class E2BToolServer {
  private sandbox: E2BSandbox;
  private server: http.Server | null = null;
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

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    this.server = http.createServer(async (nodeReq, nodeRes) => {
      // Collect request body
      const chunks: Buffer[] = [];
      for await (const chunk of nodeReq) {
        chunks.push(chunk);
      }
      const bodyText = Buffer.concat(chunks).toString();

      const url = new URL(nodeReq.url || "/", `http://${this.host}:${this.port}`);
      const method = nodeReq.method || "GET";

      // Helper to send response
      const sendResponse = (status: number, body: string | null, headers: Record<string, string>) => {
        nodeRes.writeHead(status, headers);
        nodeRes.end(body);
      };

      if (method === "OPTIONS") {
        sendResponse(204, null, corsHeaders);
        return;
      }

      // Create a fetch-compatible Request object
      const req = {
        json: async () => bodyText ? JSON.parse(bodyText) : {},
      } as Request;

      try {
        let response: Response;

        // Code execution endpoint
        if (url.pathname === "/execute" && method === "POST") {
          response = await handleExecute(req, corsHeaders);
        }
        // Upload file from local machine to sandbox
        else if (url.pathname === "/upload" && method === "POST") {
          response = await handleUpload(req, corsHeaders);
        }
        // Download file from sandbox to local machine
        else if (url.pathname === "/download" && method === "POST") {
          response = await handleDownload(req, corsHeaders);
        }
        // Check if local file exists
        else if (url.pathname === "/check-file" && method === "POST") {
          response = await handleCheckFile(req, corsHeaders);
        }
        // Health check
        else if (url.pathname === "/health" && method === "GET") {
          response = new Response(
            JSON.stringify({ status: "ok", service: "e2b-tool-server" }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } else {
          response = new Response("Not Found", {
            status: 404,
            headers: corsHeaders,
          });
        }

        // Convert Response to node response
        const responseBody = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        sendResponse(response.status, responseBody, responseHeaders);
      } catch (error: any) {
        console.error(`[e2b-server] Error: ${error.message}`);
        sendResponse(500, JSON.stringify({ error: error.message || "Internal server error" }), {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        const serverUrl = `http://${this.host}:${this.port}`;
        log(`[e2b-server] Server started on ${serverUrl}`);
        resolve(serverUrl);
      });
      this.server!.on("error", reject);
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          log("[e2b-server] Server stopped");
          resolve();
        });
      });
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

/**
 * Handle code execution requests.
 */
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
  const params = body.parameters as {
    code?: string;
    language?: SupportedLanguage;
    timeout?: number;
  };

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

/**
 * Handle file upload requests (local → sandbox).
 * Includes path sanitization for security.
 */
async function handleUpload(
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
  const params = body.parameters as {
    local_path?: string;
    sandbox_path?: string;
  };

  if (!params?.local_path) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: local_path" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Expand ~ and resolve the local path
  const requestedLocalPath = path.resolve(expandPath(params.local_path));
  
  // Use fuzzy matching to find the actual file
  const fuzzyResult = await fuzzyFindFile(requestedLocalPath);
  
  if (!fuzzyResult) {
    log(`[e2b-server] Upload failed: file not found (even with fuzzy matching)`);
    return new Response(
      JSON.stringify({
        success: false,
        error: `File not found: ${params.local_path}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const { matchedPath: localPath, stats, fuzzyMatch } = fuzzyResult;

  if (!stats.isFile()) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Path is not a file: ${localPath}` 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (fuzzyMatch) {
    console.log(`[file] 🔍 Fuzzy match: "${params.local_path}" → "${path.basename(localPath)}"`);
  }
  
  // Default sandbox path if not provided - use the actual matched filename
  const fileName = path.basename(localPath);
  const rawSandboxPath = params.sandbox_path || `/home/user/input/${fileName}`;

  // Sanitize the sandbox path for security
  const sanitizedSandboxPath = sanitizeSandboxPath(rawSandboxPath, validationConfig);
  const pathWasSanitized = sanitizedSandboxPath !== rawSandboxPath;

  if (pathWasSanitized) {
    log(`[security] Sandbox path sanitized: ${rawSandboxPath} → ${sanitizedSandboxPath}`);
  }

  // Validate the sandbox path
  const validation = validateSandboxPath(sanitizedSandboxPath, validationConfig);
  if (!validation.valid) {
    log(`[security] Sandbox path validation failed: ${validation.errors.join(", ")}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Invalid sandbox path: ${validation.errors.join(", ")}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const fileSize = Number(stats.size);
    const fileSizeMB = fileSize / (1024 * 1024);
    const fileSizeStr = fileSizeMB > 1 
      ? `${fileSizeMB.toFixed(1)} MB` 
      : `${(fileSize / 1024).toFixed(1)} KB`;
    
    log(`[e2b-server] Uploading: ${localPath} → ${sanitizedSandboxPath} (${fileSizeStr})`);
    
    if (fileSizeMB > 5) {
      console.log(`[file] Uploading large file (${fileSizeStr}), please wait...`);
    }

    // Upload to sandbox
    await sandboxInstance.uploadFile(localPath, sanitizedSandboxPath);

    const displayPath = fuzzyMatch ? path.basename(localPath) : params.local_path;
    console.log(`[file] ✓ Uploaded: ${displayPath} → ${sanitizedSandboxPath} (${fileSizeStr})`);

    const response: E2BToolResponse & { fuzzy_match?: boolean; original_path?: string } = {
      success: true,
      message: `File uploaded successfully to ${sanitizedSandboxPath}`,
      sandbox_path: sanitizedSandboxPath,
      local_path: localPath,
      size: fileSize,
      path_sanitized: pathWasSanitized,
    };

    if (fuzzyMatch) {
      response.fuzzy_match = true;
      response.original_path = params.local_path;
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    log(`[e2b-server] Upload failed: ${error.message}`);
    
    const response: E2BToolResponse = {
      success: false,
      error: error.message,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle file download requests (sandbox → local).
 * Includes path sanitization for security.
 */
async function handleDownload(
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
  const params = body.parameters as {
    sandbox_path?: string;
    local_path?: string;
  };

  if (!params?.sandbox_path) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: sandbox_path" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (!params?.local_path) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: local_path" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Sanitize the sandbox path for security
  const rawSandboxPath = params.sandbox_path;
  const sanitizedSandboxPath = sanitizeSandboxPath(rawSandboxPath, validationConfig);
  const pathWasSanitized = sanitizedSandboxPath !== rawSandboxPath;

  if (pathWasSanitized) {
    log(`[security] Sandbox path sanitized: ${rawSandboxPath} → ${sanitizedSandboxPath}`);
  }

  // Validate the sandbox path
  const validation = validateSandboxPath(sanitizedSandboxPath, validationConfig);
  if (!validation.valid) {
    log(`[security] Sandbox path validation failed: ${validation.errors.join(", ")}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Invalid sandbox path: ${validation.errors.join(", ")}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Expand ~ and resolve the local path
  const localPath = path.resolve(expandPath(params.local_path));

  log(`[e2b-server] Downloading: ${sanitizedSandboxPath} → ${localPath}`);

  try {
    // Download from sandbox
    await sandboxInstance.downloadFile(sanitizedSandboxPath, localPath);

    console.log(`[file] ✓ Downloaded: ${sanitizedSandboxPath} → ${params.local_path}`);

    const stats = await fs.stat(localPath);

    const response: E2BToolResponse = {
      success: true,
      message: `File downloaded successfully to ${params.local_path}`,
      local_path: params.local_path,
      sandbox_path: sanitizedSandboxPath,
      size: stats.size,
      path_sanitized: pathWasSanitized,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    log(`[e2b-server] Download failed: ${error.message}`);

    const response: E2BToolResponse = {
      success: false,
      error: error.message,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/** Common extensions to try when doing fuzzy file matching */
const FUZZY_EXTENSIONS = [
  ".md", ".txt", ".csv", ".json", ".py", ".js", ".ts", ".html",
  ".xml", ".yaml", ".yml", ".pdf", ".png", ".jpg", ".jpeg", ".gif",
];

/**
 * Try to find a file with fuzzy matching.
 * 1. First tries exact path
 * 2. Then tries adding common extensions
 * 3. Then looks for files in the same directory that start with the basename
 * 
 * Returns the matched path and stats, or null if not found.
 */
async function fuzzyFindFile(
  filePath: string
): Promise<{ matchedPath: string; stats: Awaited<ReturnType<typeof fs.stat>>; fuzzyMatch: boolean } | null> {
  // 1. Try exact path first
  try {
    const stats = await fs.stat(filePath);
    return { matchedPath: filePath, stats, fuzzyMatch: false };
  } catch {
    // Continue to fuzzy matching
  }

  // 2. Check if the path already has an extension - if so, don't try adding more
  const hasExtension = path.extname(filePath).length > 0;
  
  if (!hasExtension) {
    // Try adding common extensions
    for (const ext of FUZZY_EXTENSIONS) {
      const pathWithExt = filePath + ext;
      try {
        const stats = await fs.stat(pathWithExt);
        if (stats.isFile()) {
          log(`[e2b-server] Fuzzy match: ${filePath} → ${pathWithExt}`);
          return { matchedPath: pathWithExt, stats, fuzzyMatch: true };
        }
      } catch {
        // Continue trying other extensions
      }
    }
  }

  // 3. Look for files in the directory that start with the basename
  const dirname = path.dirname(filePath);
  const basename = path.basename(filePath);
  
  try {
    const files = await fs.readdir(dirname);
    // Sort to get consistent results (prefer exact prefix matches)
    const matches = files
      .filter(f => f.startsWith(basename) && f !== basename)
      .sort((a, b) => a.length - b.length); // Prefer shorter names
    
    if (matches.length > 0) {
      const matchedPath = path.join(dirname, matches[0]);
      try {
        const stats = await fs.stat(matchedPath);
        if (stats.isFile()) {
          log(`[e2b-server] Fuzzy prefix match: ${filePath} → ${matchedPath}`);
          return { matchedPath, stats, fuzzyMatch: true };
        }
      } catch {
        // Continue
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return null;
}

/**
 * Handle file check requests (check if local file exists).
 * Supports fuzzy matching - if exact path not found, tries common extensions
 * and prefix matching.
 */
async function handleCheckFile(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body = (await req.json()) as E2BToolRequest;
  const params = body.parameters as {
    path?: string;
  };

  if (!params?.path) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: path" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Expand ~ and resolve the path
  const filePath = path.resolve(expandPath(params.path));

  log(`[e2b-server] Checking file: ${params.path} → ${filePath}`);

  // Use fuzzy matching to find the file
  const result = await fuzzyFindFile(filePath);

  if (result) {
    const { matchedPath, stats, fuzzyMatch } = result;
    
    const response: E2BToolResponse & { matched_path?: string; fuzzy_match?: boolean } = {
      success: true,
      exists: true,
      is_file: stats.isFile(),
      is_directory: stats.isDirectory(),
      size: Number(stats.size),
    };

    // If we did a fuzzy match, include the actual matched path
    if (fuzzyMatch) {
      response.matched_path = matchedPath;
      response.fuzzy_match = true;
      console.log(`[file] 🔍 Fuzzy match: "${params.path}" → "${path.basename(matchedPath)}"`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } else {
    const response: E2BToolResponse = {
      success: true,
      exists: false,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

