import { Subconscious } from "subconscious";
import type { AgentTask, ExecutionResult, AgentDecision, Step } from "../types/agent";

/**
 * Evaluator: Interprets execution results using Subconscious
 * 
 * Design: Subconscious = decision engine
 * - Analyzes execution results
 * - Determines if task is complete
 * - Decides next action (continue, refine, done)
 * - Provides reasoning for transparency
 */
export class Evaluator {
  private client: Subconscious;
  private readonly engine = "tim-gpt";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("SUBCONSCIOUS_API_KEY is required");
    }
    this.client = new Subconscious({ apiKey });
  }

  /**
   * Evaluate execution result and decide next action.
   */
  async evaluateResult(
    task: AgentTask,
    step: Step,
    result: ExecutionResult,
    previousSteps: number,
    totalSteps: number
  ): Promise<AgentDecision> {
    console.log("[eval] Analyzing results...");

      // Analyze error type for better context
      const errorType = this.classifyError(result);
      const errorContext = errorType 
        ? `\nError Type: ${errorType.type}\nError Category: ${errorType.category}\nFixable: ${errorType.fixable}`
        : "";

      const instructions = `You are evaluating the execution of a step in an autonomous agent task.

Original Task: ${task.description}
${task.context ? `\nContext: ${task.context}` : ""}

Step Executed:
- ID: ${step.id}
- Description: ${step.description}
- Action: ${step.action}
${step.code ? `- Code: ${step.code.slice(0, 200)}...` : ""}

Execution Result:
- Success: ${result.success}
- Exit Code: ${result.exitCode}
- Output: ${result.stdout || "(empty)"}
- Errors: ${result.stderr || "(none)"}
- Duration: ${result.duration}ms
${result.timeout ? "- Timeout: Yes" : ""}
${result.generatedFiles ? `- Generated Files: ${result.generatedFiles.join(", ")}` : ""}
${errorContext}

Progress: ${previousSteps} of ${totalSteps} steps completed

Your job is to decide the next action:
1. "continue" - Task is progressing well, move to next step
2. "refine" - The approach needs adjustment, create a new plan (use for fixable errors)
3. "done" - Task is complete, provide final output

IMPORTANT:
- If the step succeeded AND the task appears complete, return "done"
- If the step failed due to a fixable issue (syntax error, missing file, etc.), return "refine"
- If the step failed due to a fatal/unfixable issue, return "done" with error explanation
- If the step succeeded but more work is needed, return "continue"
- Always provide clear reasoning
- If error is fixable, suggest what needs to be fixed

Respond with JSON in this exact format:
{
  "nextStep": "continue" | "refine" | "done",
  "reasoning": "Explanation of your decision",
  "output": "Final result summary (only if nextStep is 'done')",
  "needsCode": true or false (whether next step needs code execution)
}

Return ONLY valid JSON, no markdown, no code blocks.`;

    try {
      const run = await this.client.run({
        engine: this.engine,
        input: {
          instructions,
        },
        options: {
          awaitCompletion: true,
        },
      });

      // Wait for completion if not already complete
      let finalRun = run;
      if (run.status !== "succeeded" && run.status !== "failed") {
        finalRun = await this.client.get(run.runId);
      }

      if (!finalRun.result?.answer) {
        throw new Error(`No answer received from Subconscious. Status: ${finalRun.status}`);
      }

      // Parse JSON response
      let answerText = finalRun.result.answer;
      answerText = answerText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      const jsonMatch = answerText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        answerText = jsonMatch[0];
      }

      const decision = JSON.parse(answerText) as AgentDecision;

      // Validate decision
      if (!["continue", "refine", "done"].includes(decision.nextStep)) {
        throw new Error(`Invalid nextStep: ${decision.nextStep}`);
      }

      console.log(`[decision] Next: ${decision.nextStep}`);
      console.log(`[decision] Reasoning: ${decision.reasoning}`);

      return decision;
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        // Fallback: make reasonable decision based on execution result
        console.log("[decision] Failed to parse decision, using fallback logic");
        return {
          nextStep: result.success ? "continue" : "refine",
          reasoning: `Fallback: ${result.success ? "Step succeeded" : "Step failed"}`,
          needsCode: true,
        };
      }
      throw new Error(`Evaluation failed: ${error.message}`);
    }
  }

  /**
   * Evaluate if the overall task is complete.
   * Used as a final check after all steps.
   */
  async evaluateTaskCompletion(
    task: AgentTask,
    executionHistory: Array<{ step: Step; result: ExecutionResult }>
  ): Promise<AgentDecision> {
    console.log("[eval] Evaluating overall task completion...");

    const historySummary = executionHistory
      .map((h, i) => `Step ${i + 1}: ${h.step.description} - ${h.result.success ? "SUCCESS" : "FAILED"}`)
      .join("\n");

    const instructions = `Evaluate if the autonomous agent task is complete.

Task: ${task.description}
${task.context ? `\nContext: ${task.context}` : ""}

Execution History:
${historySummary}

Determine if the task has been successfully completed. Respond with JSON:
{
  "nextStep": "done" | "refine",
  "reasoning": "Explanation",
  "output": "Summary of what was accomplished (if done)"
}`;

    try {
      const run = await this.client.run({
        engine: this.engine,
        input: {
          instructions,
        },
        options: {
          awaitCompletion: true,
        },
      });

      // Wait for completion if not already complete
      let finalRun = run;
      if (run.status !== "succeeded" && run.status !== "failed") {
        finalRun = await this.client.get(run.runId);
      }

      if (!finalRun.result?.answer) {
        return {
          nextStep: "done",
          reasoning: "All steps completed",
          output: "Task execution finished",
        };
      }

      let answerText = finalRun.result.answer;
      answerText = answerText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      const jsonMatch = answerText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        answerText = jsonMatch[0];
      }

      return JSON.parse(answerText) as AgentDecision;
    } catch (error: any) {
      // Fallback: assume done if all steps succeeded
      const allSucceeded = executionHistory.every((h) => h.result.success);
      return {
        nextStep: allSucceeded ? "done" : "refine",
        reasoning: allSucceeded ? "All steps succeeded" : "Some steps failed",
        output: allSucceeded ? "Task completed successfully" : "Task needs refinement",
      };
    }
  }

  /**
   * Classify error type to help with decision making.
   */
  private classifyError(result: ExecutionResult): {
    type: string;
    category: "syntax" | "runtime" | "environment" | "network" | "unknown";
    fixable: boolean;
  } | null {
    if (result.success) return null;

    const errorLower = (result.stderr || "").toLowerCase();

    // Syntax errors - usually fixable
    if (errorLower.includes("syntax error") || errorLower.includes("syntaxerror")) {
      return { type: "Syntax Error", category: "syntax", fixable: true };
    }

    // Missing files/modules - fixable
    if (
      errorLower.includes("no such file") ||
      errorLower.includes("file not found") ||
      errorLower.includes("module not found") ||
      errorLower.includes("cannot find module")
    ) {
      return { type: "Missing Resource", category: "environment", fixable: true };
    }

    // Permission errors - sometimes fixable
    if (errorLower.includes("permission denied") || errorLower.includes("eacces")) {
      return { type: "Permission Error", category: "environment", fixable: true };
    }

    // Network/timeout - may be fixable
    if (errorLower.includes("timeout") || errorLower.includes("connection")) {
      return { type: "Network/Timeout Error", category: "network", fixable: true };
    }

    // Runtime errors - may or may not be fixable
    if (errorLower.includes("typeerror") || errorLower.includes("valueerror")) {
      return { type: "Runtime Error", category: "runtime", fixable: true };
    }

    // Unknown errors
    return { type: "Unknown Error", category: "unknown", fixable: false };
  }
}
