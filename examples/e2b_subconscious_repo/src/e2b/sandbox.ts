import { Sandbox } from "@e2b/sdk";
import { promises as fs } from "fs";
import * as path from "path";
import type { ExecutionResult } from "../types/agent";
import { verbose } from "../config";

/** Supported programming languages */
export type SupportedLanguage = 
  | "python" 
  | "bash" 
  | "javascript" 
  | "typescript"
  | "cpp" 
  | "c++" 
  | "c" 
  | "go" 
  | "rust" 
  | "ruby" 
  | "java";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * E2B Sandbox Wrapper
 * 
 * Design: E2B is the ONLY execution environment.
 * - All generated code runs in isolated sandbox
 * - No local file system access
 * - Automatic cleanup on close
 * - Supports Python, Bash, Node.js by default
 */
export class E2BSandbox {
  private sandbox: Sandbox | null = null;
  private sandboxId: string | null = null;
  private defaultTimeout: number = 5 * 60 * 1000; // 5 minutes default

  /**
   * Initialize E2B sandbox.
   * Uses 'base' template which supports Python, Bash, Node.js
   */
  async initialize(): Promise<void> {
    if (this.sandbox) {
      log("[e2b] Sandbox already initialized");
      return;
    }

    log("[e2b] Launching sandbox...");
    try {
      // E2B base template supports Python, Bash, and Node.js
      // Template is passed as a string parameter
      this.sandbox = await Sandbox.create("base");
      this.sandboxId = this.sandbox.sandboxId;
      log(`[e2b] Sandbox ready (ID: ${this.sandboxId.slice(0, 8)}...)`);
    } catch (error) {
      throw new Error(`Failed to initialize E2B sandbox: ${error}`);
    }
  }

  /**
   * Execute code in the sandbox.
   * Automatically detects language based on code content or uses Python as default.
   * Supports timeout for long-running commands.
   */
  async executeCode(
    code: string,
    language: SupportedLanguage = "python",
    timeout?: number
  ): Promise<ExecutionResult> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized. Call initialize() first.");
    }

    log(`[e2b] Executing ${language} code...`);
    const executionTimeout = timeout || this.defaultTimeout;

    const startTime = Date.now();

    try {
      let command: string;
      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      // Apply environment variables if set
      const envVars = (this.sandbox as any)._envVars || {};
      const envPrefix = Object.entries(envVars)
        .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join(" ");

      switch (language) {
        case "python":
          // Write code to temp file and execute
          // Use /home/user directory which has proper write permissions
          const pythonFile = "/home/user/exec.py";
          await this.sandbox.files.write(pythonFile, code);
          command = envPrefix ? `${envPrefix} python3 ${pythonFile}` : `python3 ${pythonFile}`;
          break;

        case "bash":
          command = envPrefix ? `${envPrefix} ${code}` : code;
          break;

        case "javascript":
          const jsFile = "/home/user/exec.js";
          await this.sandbox.files.write(jsFile, code);
          command = envPrefix ? `${envPrefix} node ${jsFile}` : `node ${jsFile}`;
          break;

        case "typescript":
          const tsFile = "/home/user/exec.ts";
          await this.sandbox.files.write(tsFile, code);
          // Use ts-node or compile with tsc then run
          command = envPrefix 
            ? `${envPrefix} npx ts-node ${tsFile}` 
            : `npx ts-node ${tsFile}`;
          break;

        case "cpp":
        case "c++":
          const cppFile = "/home/user/exec.cpp";
          const cppBinary = "/home/user/exec_cpp";
          await this.sandbox.files.write(cppFile, code);
          // Compile with g++ then execute
          command = `g++ -O2 -o ${cppBinary} ${cppFile} && ${cppBinary}`;
          break;

        case "c":
          const cFile = "/home/user/exec.c";
          const cBinary = "/home/user/exec_c";
          await this.sandbox.files.write(cFile, code);
          // Compile with gcc then execute
          command = `gcc -O2 -o ${cBinary} ${cFile} && ${cBinary}`;
          break;

        case "go":
          const goFile = "/home/user/exec.go";
          await this.sandbox.files.write(goFile, code);
          command = `go run ${goFile}`;
          break;

        case "rust":
          const rsFile = "/home/user/exec.rs";
          const rsBinary = "/home/user/exec_rs";
          await this.sandbox.files.write(rsFile, code);
          // Compile with rustc then execute
          command = `rustc -O -o ${rsBinary} ${rsFile} && ${rsBinary}`;
          break;

        case "ruby":
          const rbFile = "/home/user/exec.rb";
          await this.sandbox.files.write(rbFile, code);
          command = envPrefix ? `${envPrefix} ruby ${rbFile}` : `ruby ${rbFile}`;
          break;

        case "java":
          // Java requires class name to match filename
          // Extract class name from code or use default
          const classMatch = code.match(/public\s+class\s+(\w+)/);
          const className = classMatch ? classMatch[1] : "Main";
          const javaFile = `/home/user/${className}.java`;
          await this.sandbox.files.write(javaFile, code);
          command = `cd /home/user && javac ${className}.java && java ${className}`;
          break;

        default:
          throw new Error(`Unsupported language: ${language}. Supported: python, bash, javascript, typescript, cpp, c, go, rust, ruby, java`);
      }

      // Execute command using E2B SDK v2 API with timeout
      // commands.run() returns a promise with { exitCode, stdout, stderr, error }
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Execution timeout")), executionTimeout);
      });

      const result = await Promise.race([
        this.sandbox.commands.run(command),
        timeoutPromise,
      ]);
      
      // Extract output from result
      stdout = result.stdout || "";
      stderr = result.stderr || "";
      exitCode = result.exitCode ?? (result.error ? 1 : 0);

      const duration = Date.now() - startTime;

      return {
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        duration,
        timeout: false,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const isTimeout = error?.message?.includes("timeout") || duration >= executionTimeout;
      
      return {
        success: false,
        stdout: "",
        stderr: String(error?.message || error),
        exitCode: 1,
        duration,
        timeout: isTimeout,
      };
    }
  }

  /**
   * Write a file to the sandbox filesystem.
   * Useful for multi-file projects or data persistence.
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    await this.sandbox.files.write(path, content);
  }

  /**
   * Read a file from the sandbox filesystem.
   */
  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    return await this.sandbox.files.read(path);
  }

  /**
   * List files in a directory.
   */
  async listFiles(path: string = "/home/user"): Promise<any[]> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    return await this.sandbox.files.list(path);
  }

  /**
   * Cleanup: Kill sandbox and free resources.
   */
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      log("[e2b] Cleaning up sandbox...");
      try {
        await this.sandbox.kill();
      } catch (error) {
        console.error("[e2b] Error killing sandbox:", error);
      }
      this.sandbox = null;
      this.sandboxId = null;
    }
  }

  /**
   * Get current sandbox ID for debugging.
   */
  getId(): string | null {
    return this.sandboxId;
  }

  /**
   * Check network connectivity (simple test).
   */
  async checkNetworkConnectivity(): Promise<boolean> {
    if (!this.sandbox) {
      return false;
    }

    try {
      // Simple connectivity test
      const result = await this.sandbox.commands.run(
        "curl -s -o /dev/null -w '%{http_code}' https://www.google.com || echo '0'"
      );
      return result.stdout.trim() === "200";
    } catch {
      return false;
    }
  }

  /**
   * Upload a local file to the sandbox.
   * Reads the file from the local filesystem and writes it to the sandbox.
   * Handles both text and binary files.
   */
  async uploadFile(localPath: string, sandboxPath: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    try {
      // Check if file exists
      await fs.access(localPath);
      
      // Get file stats to check size
      const stats = await fs.stat(localPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 10) {
        log(`[e2b] Warning: File is large (${fileSizeMB.toFixed(2)}MB), upload may take time`);
      }

      // Read file - try as text first, fallback to binary
      let content: string;
      try {
        content = await fs.readFile(localPath, "utf-8");
      } catch {
        // If UTF-8 fails, read as base64 for binary files
        const buffer = await fs.readFile(localPath);
        content = buffer.toString("base64");
        // Note: This is a simple approach. For true binary support, 
        // E2B SDK might need different handling
      }

      // Ensure directory exists in sandbox
      const dir = path.dirname(sandboxPath);
      if (dir !== "/" && dir !== ".") {
        try {
          await this.sandbox.commands.run(`mkdir -p ${dir}`);
        } catch {
          // Directory might already exist, ignore
        }
      }

      // Write to sandbox
      await this.sandbox.files.write(sandboxPath, content);
      
      // Ensure the file and directory are readable
      try {
        await this.sandbox.commands.run(`chmod -R 755 ${dir}`);
        await this.sandbox.commands.run(`chmod 644 ${sandboxPath}`);
      } catch {
        // Ignore permission errors, file might still be accessible
      }
      
      // Verify the file was written successfully
      try {
        const lsResult = await this.sandbox.commands.run(`ls -la ${sandboxPath}`);
        log(`[e2b] Uploaded ${localPath} → ${sandboxPath} (${fileSizeMB.toFixed(2)}MB)`);
        log(`[e2b] File verified: ${lsResult.stdout.trim()}`);

        // Also verify file can be read (first few bytes)
        const headResult = await this.sandbox.commands.run(`head -c 100 ${sandboxPath}`);
        if (headResult.exitCode === 0) {
          log(`[e2b] File readable (first 100 chars): ${headResult.stdout.slice(0, 50)}...`);
        }
      } catch {
        log(`[e2b] Uploaded ${localPath} → ${sandboxPath} (${fileSizeMB.toFixed(2)}MB)`);
        log(`[e2b] Warning: Could not verify file exists`);
      }
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${localPath}`);
      }
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Download a file from the sandbox to the local filesystem.
   * Creates directory structure if needed.
   */
  async downloadFile(sandboxPath: string, localPath: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    try {
      // Read file from sandbox
      const content = await this.sandbox.files.read(sandboxPath);

      // Create directory if needed
      const dir = path.dirname(localPath);
      await fs.mkdir(dir, { recursive: true });

      // Write to local filesystem
      await fs.writeFile(localPath, content, "utf-8");
      log(`[e2b] Downloaded ${sandboxPath} → ${localPath}`);
    } catch (error: any) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Upload a directory recursively to the sandbox.
   * Preserves directory structure and skips hidden files.
   */
  async uploadDirectory(localDir: string, sandboxDir: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    const hiddenPatterns = [".git", ".DS_Store", ".env", "node_modules", "__pycache__"];
    const self = this;

    async function uploadRecursive(local: string, sandbox: string): Promise<void> {
      const entries = await fs.readdir(local, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files and directories
        if (hiddenPatterns.some(pattern => entry.name.includes(pattern))) {
          continue;
        }

        const localPath = path.join(local, entry.name);
        const sandboxPath = `${sandbox}/${entry.name}`;

        if (entry.isDirectory()) {
          await uploadRecursive(localPath, sandboxPath);
        } else {
          await self.uploadFile(localPath, sandboxPath);
        }
      }
    }

    try {
      await uploadRecursive(localDir, sandboxDir);
      log(`[e2b] Uploaded directory ${localDir} → ${sandboxDir}`);
    } catch (error: any) {
      throw new Error(`Failed to upload directory: ${error.message}`);
    }
  }

  /**
   * Set environment variables in the sandbox.
   * Note: E2B SDK may handle this differently - adjust based on actual API.
   */
  async setEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }

    // E2B SDK v2 may not have direct env var API
    // For now, we'll set them via shell commands before execution
    // This is a workaround - check E2B docs for proper API
    const envString = Object.entries(vars)
      .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
      .join(" && ");

    if (envString) {
      // Store env vars for use in executeCode
      (this.sandbox as any)._envVars = vars;
      log(`[e2b] Environment variables set: ${Object.keys(vars).join(", ")}`);
    }
  }
}
