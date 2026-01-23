/**
 * Core type definitions for the agent system.
 *
 * Design: Subconscious orchestrates tool calls directly.
 * - Task: User input with optional file references
 * - ExecutionResult: E2B sandbox output (used by tool server)
 */

export interface AgentTask {
  description: string;
  context?: string;
  files?: Array<{
    localPath: string;
    sandboxPath: string;
    type: "input" | "output";
  }>;
  environmentVariables?: Record<string, string>;
  maxExecutionTime?: number;
}

/**
 * Execution result from E2B sandbox.
 * Used by the tool server to return results to Subconscious.
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
