/**
 * Core type definitions for the agent system.
 * 
 * Design: Subconscious orchestrates tool calls directly.
 * - Task: User input
 * - ExecutionResult: E2B output (used by tool server)
 * - Tool types: For FunctionTool registration
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

/**
 * Tool request format from Subconscious.
 */
export interface E2BToolRequest {
  tool_name?: string;
  parameters?: {
    code: string;
    language?: "python" | "bash" | "javascript";
    timeout?: number; // in seconds
  };
  request_id?: string;
}

// ============================================================================
// DEPRECATED: Old workflow types (kept for backward compatibility during migration)
// ============================================================================

/**
 * @deprecated No longer used - Subconscious handles planning directly
 */
export interface Plan {
  steps: Step[];
  reasoning: string;
}

/**
 * @deprecated No longer used - Subconscious handles step execution via tools
 */
export interface Step {
  id: string;
  action: "code" | "analyze" | "decide";
  description: string;
  code?: string;
  language?: "python" | "bash" | "javascript";
}

/**
 * @deprecated No longer used - Subconscious handles decision making directly
 */
export interface AgentDecision {
  nextStep: "continue" | "refine" | "done";
  reasoning: string;
  output?: string;
  needsCode?: boolean;
}

/**
 * @deprecated No longer used - State is managed by Subconscious
 */
export interface AgentState {
  task: AgentTask;
  plan?: Plan;
  currentStepIndex: number;
  executionHistory: Array<{
    step: Step;
    result: ExecutionResult;
    decision?: AgentDecision;
  }>;
}
