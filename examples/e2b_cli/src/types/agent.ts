/**
 * Core type definitions for the E2B agent system.
 */

/**
 * Execution result from the E2B sandbox.
 * Returned by E2BSandbox.executeCode() and surfaced to the agent loop.
 */
export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration?: number;
  timeout?: boolean;
  generatedFiles?: string[];
}
