import { Subconscious } from "subconscious";
import type { AgentTask, Plan, Step } from "../types/agent";

/**
 * Planner: Subconscious-powered task decomposition
 * 
 * Design: Subconscious = reasoning engine
 * - Takes natural language task
 * - Decomposes into executable steps
 * - Returns structured plan with code snippets
 * - No execution here, only planning
 */
export class Planner {
  private client: Subconscious;
  private readonly engine = "tim-gpt";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("SUBCONSCIOUS_API_KEY is required");
    }
    this.client = new Subconscious({ apiKey });
  }

  /**
   * Create a plan from a task description.
   * Uses Subconscious to reason about the task and break it into steps.
   */
  async createPlan(task: AgentTask): Promise<Plan> {
    console.log("[plan] Breaking task into steps...");

    const instructions = `You are an expert task planner. Your job is to decompose a user's task into concrete, executable steps.

Task: ${task.description}
${task.context ? `\nContext: ${task.context}` : ""}

For each step, determine:
1. If it requires code execution (action: "code") or just analysis (action: "analyze")
2. The specific code to execute (if action is "code")
3. The programming language to use (python, bash, or javascript)

IMPORTANT RULES:
- If a step requires code execution, you MUST provide the actual code in the "code" field
- Use Python for data processing, calculations, file operations (use 'requests' library for HTTP)
- Use Bash for system commands, file management, simple scripts
- Use JavaScript/Node.js for web scraping, API calls, JSON processing (use 'fetch' for HTTP)
- The sandbox has network access - you can make HTTP requests, call APIs, fetch data from URLs
- Steps should be atomic and testable
- Each step should have a clear success criterion
- For API calls, include error handling and timeout logic

Respond with a JSON object in this exact format:
{
  "reasoning": "Brief explanation of your approach and why you chose these steps",
  "steps": [
    {
      "id": "step_1",
      "action": "code",
      "description": "What this step accomplishes",
      "code": "actual code to execute",
      "language": "python"
    },
    {
      "id": "step_2",
      "action": "analyze",
      "description": "Analysis or decision step (no code needed)"
    }
  ]
}

Return ONLY valid JSON, no markdown, no code blocks, no explanations outside the JSON.`;

    let finalRun: any = null;
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
      finalRun = run;
      if (run.status !== "succeeded" && run.status !== "failed") {
        finalRun = await this.client.get(run.runId);
      }

      if (!finalRun.result?.answer) {
        throw new Error(`No answer received from Subconscious. Status: ${finalRun.status}`);
      }

      // Parse the JSON response
      let answerText = finalRun.result.answer;
      
      // Remove markdown code blocks if present
      answerText = answerText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      // Extract JSON if wrapped in other text
      const jsonMatch = answerText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        answerText = jsonMatch[0];
      }

      const parsed = JSON.parse(answerText) as Plan;

      // Validate plan structure
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error("Invalid plan: missing steps array");
      }

      if (!parsed.reasoning) {
        parsed.reasoning = "No reasoning provided";
      }

      console.log(`[plan] Created ${parsed.steps.length} step(s)`);
      console.log(`[plan] Reasoning: ${parsed.reasoning}`);

      return parsed;
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse plan JSON: ${error.message}\nResponse: ${finalRun?.result?.answer || "No response"}`);
      }
      throw new Error(`Planning failed: ${error.message}`);
    }
  }

  /**
   * Refine an existing plan based on execution results.
   * Used when the evaluator determines the approach needs adjustment.
   */
  async refinePlan(
    task: AgentTask,
    previousPlan: Plan,
    executionResults: Array<{ step: Step; result: any }>
  ): Promise<Plan> {
    console.log("[plan] Refining plan based on results...");

    const resultsSummary = executionResults
      .map((r, i) => `Step ${i + 1} (${r.step.id}): ${r.result.success ? "SUCCESS" : "FAILED"}\nOutput: ${r.result.stdout}\nErrors: ${r.result.stderr}`)
      .join("\n\n");

    const instructions = `The previous plan didn't work as expected. Refine the approach.

Original Task: ${task.description}
${task.context ? `\nContext: ${task.context}` : ""}

Previous Plan:
${JSON.stringify(previousPlan, null, 2)}

Execution Results:
${resultsSummary}

Create a new, refined plan that addresses the issues encountered. Use the same JSON format as before.`;

    return this.createPlan(task);
  }
}
