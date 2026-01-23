import { E2BSandbox } from "../e2b/sandbox";
import { extractFilePaths } from "../utils/outputManager";
import type { Step, ExecutionResult } from "../types/agent";

/**
 * Executor: Runs code in E2B sandbox
 * 
 * Design: Pure execution, no reasoning
 * - Takes a Step with code
 * - Executes in E2B sandbox
 * - Returns structured result
 * - Handles errors gracefully
 */
export class Executor {
  private sandbox: E2BSandbox;

  constructor(sandbox: E2BSandbox) {
    this.sandbox = sandbox;
  }

  /**
   * Execute a single step.
   * If step doesn't require code, returns success immediately.
   */
  async executeStep(step: Step, timeout?: number): Promise<ExecutionResult> {
    console.log(`[execute] Step ${step.id}: ${step.description}`);

    // Non-code steps (analyze, decide) don't need execution
    if (step.action !== "code" || !step.code) {
      console.log(`[execute] No code to execute (action: ${step.action})`);
      return {
        success: true,
        stdout: `Step completed: ${step.description}`,
        stderr: "",
        exitCode: 0,
      };
    }

    // Execute code in sandbox with optional timeout
    const language = step.language || "python";
    const result = await this.sandbox.executeCode(step.code, language, timeout);

    // Detect generated output files from stdout
    const generatedFiles = extractFilePaths(result.stdout);
    if (generatedFiles.length > 0) {
      result.generatedFiles = generatedFiles;
      console.log(`[result] Detected ${generatedFiles.length} output file(s): ${generatedFiles.join(", ")}`);
    }

    // Enhanced error detection and messages
    if (!result.success) {
      const errorMessage = this.analyzeError(result.stderr, result.exitCode);
      if (errorMessage) {
        console.log(`[result] Error analysis: ${errorMessage}`);
      }
    }

    // Log results
    if (result.success) {
      console.log(`[result] Execution succeeded (${result.duration}ms)`);
      if (result.stdout) {
        // Truncate long output for readability
        const output = result.stdout.length > 500 
          ? result.stdout.slice(0, 500) + "\n... (truncated)"
          : result.stdout;
        console.log(`[result] Output:\n${output}`);
      }
    } else {
      console.log(`[result] Execution failed (exit code: ${result.exitCode})`);
      if (result.stderr) {
        // Truncate long error output
        const errorOutput = result.stderr.length > 500 
          ? result.stderr.slice(0, 500) + "\n... (truncated)"
          : result.stderr;
        console.log(`[result] Errors:\n${errorOutput}`);
      }
    }

    return result;
  }

  /**
   * Execute multiple steps sequentially.
   * Stops on first failure unless continueOnError is true.
   */
  async executeSteps(
    steps: Step[],
    continueOnError: boolean = false
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const step of steps) {
      const result = await this.executeStep(step);
      results.push(result);

      if (!result.success && !continueOnError) {
        console.log(`[execute] Stopping execution due to failure`);
        break;
      }
    }

    return results;
  }

  /**
   * Analyze error and provide actionable suggestions.
   */
  private analyzeError(stderr: string, exitCode: number): string | null {
    const errorLower = stderr.toLowerCase();

    // File not found
    if (errorLower.includes("no such file") || errorLower.includes("file not found")) {
      return "File not found. Check that the file path is correct and the file exists in the sandbox.";
    }

    // Permission denied
    if (errorLower.includes("permission denied") || errorLower.includes("eacces")) {
      return "Permission denied. The file or directory may not be accessible. Check file permissions.";
    }

    // Module not found (Python)
    if (errorLower.includes("module not found") || errorLower.includes("importerror")) {
      return "Module not found. You may need to install the required package using pip.";
    }

    // Syntax error
    if (errorLower.includes("syntax error") || errorLower.includes("syntaxerror")) {
      return "Syntax error in code. Check for typos, missing brackets, or incorrect syntax.";
    }

    // Import error (Node.js)
    if (errorLower.includes("cannot find module") || errorLower.includes("require")) {
      return "Module not found. You may need to install the required package using npm.";
    }

    // Network/timeout errors
    if (errorLower.includes("timeout") || errorLower.includes("connection")) {
      return "Network or timeout error. The request may have taken too long or the server is unreachable.";
    }

    // Generic error
    if (exitCode !== 0) {
      return `Execution failed with exit code ${exitCode}. Check the error output above for details.`;
    }

    return null;
  }
}
