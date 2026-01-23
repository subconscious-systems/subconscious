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
 * All code execution happens in isolated E2B cloud sandboxes.
 * Supports Python, Bash, JavaScript, TypeScript, and compiled languages.
 */
export class E2BSandbox {
  private sandbox: Sandbox | null = null;
  private sandboxId: string | null = null;
  private defaultTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize E2B sandbox with the 'base' template.
   * Creates input/output directories and installs common packages.
   */
  async initialize(): Promise<void> {
    if (this.sandbox) {
      log("[e2b] Sandbox already initialized");
      return;
    }

    log("[e2b] Launching sandbox...");
    try {
      this.sandbox = await Sandbox.create("base");
      this.sandboxId = this.sandbox.sandboxId;
      log(`[e2b] Sandbox ready (ID: ${this.sandboxId.slice(0, 8)}...)`);
      await this.setupEnvironment();
    } catch (error) {
      throw new Error(`Failed to initialize E2B sandbox: ${error}`);
    }
  }

  /**
   * Setup sandbox environment with required directories and packages.
   */
  private async setupEnvironment(): Promise<void> {
    if (!this.sandbox) return;

    log("[e2b] Setting up environment...");

    try {
      await this.sandbox.commands.run(
        "mkdir -p /home/user/input /home/user/output"
      );
      await this.sandbox.commands.run(
        "chmod 755 /home/user/input /home/user/output"
      );
      log("[e2b] Created input/output directories");
    } catch (error) {
      console.error("[e2b] Warning: Failed to create directories:", error);
    }

    try {
      log("[e2b] Installing Python packages (numpy, matplotlib, pandas)...");
      const installResult = await this.sandbox.commands.run(
        "pip install --quiet numpy matplotlib pandas 2>/dev/null || " +
          "pip3 install --quiet numpy matplotlib pandas 2>/dev/null",
        { timeoutMs: 120000 }
      );
      if (installResult.exitCode === 0) {
        log("[e2b] Python packages installed successfully");
      } else {
        log("[e2b] Warning: Some packages may not have installed correctly");
      }
    } catch (error) {
      console.error("[e2b] Warning: Failed to install Python packages:", error);
    }
  }

  /**
   * Execute code in the sandbox.
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
      const envVars = (this.sandbox as any)._envVars || {};
      const envPrefix = Object.entries(envVars)
        .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
        .join(" ");

      const command = await this.buildCommand(code, language, envPrefix);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Execution timeout")), executionTimeout);
      });

      const result = await Promise.race([
        this.sandbox.commands.run(command),
        timeoutPromise,
      ]);

      const duration = Date.now() - startTime;

      return {
        success: result.exitCode === 0,
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || "").trim(),
        exitCode: result.exitCode ?? (result.error ? 1 : 0),
        duration,
        timeout: false,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const isTimeout =
        error?.message?.includes("timeout") || duration >= executionTimeout;

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
   * Build the command to execute based on language.
   */
  private async buildCommand(
    code: string,
    language: SupportedLanguage,
    envPrefix: string
  ): Promise<string> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    switch (language) {
      case "python": {
        const file = "/home/user/exec.py";
        await this.sandbox.files.write(file, code);
        return envPrefix ? `${envPrefix} python3 ${file}` : `python3 ${file}`;
      }

      case "bash":
        return envPrefix ? `${envPrefix} ${code}` : code;

      case "javascript": {
        const file = "/home/user/exec.js";
        await this.sandbox.files.write(file, code);
        return envPrefix ? `${envPrefix} node ${file}` : `node ${file}`;
      }

      case "typescript": {
        const file = "/home/user/exec.ts";
        await this.sandbox.files.write(file, code);
        return envPrefix
          ? `${envPrefix} npx ts-node ${file}`
          : `npx ts-node ${file}`;
      }

      case "cpp":
      case "c++": {
        const file = "/home/user/exec.cpp";
        const binary = "/home/user/exec_cpp";
        await this.sandbox.files.write(file, code);
        return `g++ -O2 -o ${binary} ${file} && ${binary}`;
      }

      case "c": {
        const file = "/home/user/exec.c";
        const binary = "/home/user/exec_c";
        await this.sandbox.files.write(file, code);
        return `gcc -O2 -o ${binary} ${file} && ${binary}`;
      }

      case "go": {
        const file = "/home/user/exec.go";
        await this.sandbox.files.write(file, code);
        return `go run ${file}`;
      }

      case "rust": {
        const file = "/home/user/exec.rs";
        const binary = "/home/user/exec_rs";
        await this.sandbox.files.write(file, code);
        return `rustc -O -o ${binary} ${file} && ${binary}`;
      }

      case "ruby": {
        const file = "/home/user/exec.rb";
        await this.sandbox.files.write(file, code);
        return envPrefix ? `${envPrefix} ruby ${file}` : `ruby ${file}`;
      }

      case "java": {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : "Main";
        const file = `/home/user/${className}.java`;
        await this.sandbox.files.write(file, code);
        return `cd /home/user && javac ${className}.java && java ${className}`;
      }

      default:
        throw new Error(
          `Unsupported language: ${language}. Supported: python, bash, ` +
            "javascript, typescript, cpp, c, go, rust, ruby, java"
        );
    }
  }

  /**
   * Write a file to the sandbox filesystem.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");
    await this.sandbox.files.write(filePath, content);
  }

  /**
   * Read a file from the sandbox filesystem.
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");
    return await this.sandbox.files.read(filePath);
  }

  /**
   * List files in a directory.
   */
  async listFiles(dirPath = "/home/user"): Promise<any[]> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");
    return await this.sandbox.files.list(dirPath);
  }

  /**
   * Upload a local file to the sandbox.
   */
  async uploadFile(localPath: string, sandboxPath: string): Promise<void> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    try {
      await fs.access(localPath);

      const stats = await fs.stat(localPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > 10) {
        log(`[e2b] Warning: Large file (${fileSizeMB.toFixed(2)}MB), upload may take time`);
      }

      let content: string;
      try {
        content = await fs.readFile(localPath, "utf-8");
      } catch {
        const buffer = await fs.readFile(localPath);
        content = buffer.toString("base64");
      }

      const dir = path.dirname(sandboxPath);
      if (dir !== "/" && dir !== ".") {
        try {
          await this.sandbox.commands.run(`mkdir -p ${dir}`);
        } catch {
          // Directory might already exist
        }
      }

      await this.sandbox.files.write(sandboxPath, content);

      try {
        await this.sandbox.commands.run(`chmod -R 755 ${dir}`);
        await this.sandbox.commands.run(`chmod 644 ${sandboxPath}`);
      } catch {
        // Ignore permission errors
      }

      log(`[e2b] Uploaded ${localPath} → ${sandboxPath}`);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${localPath}`);
      }
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Download a file from the sandbox to the local filesystem.
   */
  async downloadFile(sandboxPath: string, localPath: string): Promise<void> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    try {
      const dir = path.dirname(localPath);
      await fs.mkdir(dir, { recursive: true });

      const binaryExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".bin",
        ".exe",
        ".ico",
        ".svg",
      ];
      const ext = path.extname(localPath).toLowerCase();
      const isBinary = binaryExtensions.includes(ext);

      if (isBinary) {
        const result = await this.sandbox.commands.run(`base64 "${sandboxPath}"`);
        if (result.exitCode !== 0) {
          throw new Error(`Failed to read binary file: ${result.stderr}`);
        }
        const buffer = Buffer.from(result.stdout, "base64");
        await fs.writeFile(localPath, buffer);
      } else {
        const content = await this.sandbox.files.read(sandboxPath);
        await fs.writeFile(localPath, content, "utf-8");
      }

      log(`[e2b] Downloaded ${sandboxPath} → ${localPath}`);
    } catch (error: any) {
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  /**
   * Set environment variables in the sandbox.
   */
  async setEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    if (!this.sandbox) throw new Error("Sandbox not initialized");

    if (Object.keys(vars).length > 0) {
      (this.sandbox as any)._envVars = vars;
      log(`[e2b] Environment variables set: ${Object.keys(vars).join(", ")}`);
    }
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
}
