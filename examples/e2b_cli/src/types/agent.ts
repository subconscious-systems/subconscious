/**
 * Core type definitions for the agent system.
 *
 * Design: Subconscious orchestrates tool calls directly.
 * - The agent handles file operations through upload_local_file and download_file tools
 * - ExecutionResult: E2B sandbox output (used by tool server)
 */

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
