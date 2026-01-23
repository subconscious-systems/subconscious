import type { AgentDecision } from "../types/agent";

/**
 * Termination Handler: Explicit stop conditions
 * 
 * Design: Simple, predictable termination logic
 * - Max steps limit
 * - Explicit done signals
 * - No hidden state
 */
export class TerminationHandler {
  private stepCount: number = 0;
  private readonly maxSteps: number;
  private readonly maxRefinements: number;
  private refinementCount: number = 0;

  constructor(maxSteps: number = 10, maxRefinements: number = 3) {
    this.maxSteps = maxSteps;
    this.maxRefinements = maxRefinements;
  }

  /**
   * Check if agent can continue executing steps.
   */
  canContinue(): boolean {
    return this.stepCount < this.maxSteps;
  }

  /**
   * Check if agent can refine the plan.
   */
  canRefine(): boolean {
    return this.refinementCount < this.maxRefinements;
  }

  /**
   * Increment step counter.
   */
  incrementStep(): void {
    this.stepCount++;
    console.log(`[loop] Step ${this.stepCount}/${this.maxSteps}`);
  }

  /**
   * Increment refinement counter.
   */
  incrementRefinement(): void {
    this.refinementCount++;
    console.log(`[loop] Refinement ${this.refinementCount}/${this.maxRefinements}`);
  }

  /**
   * Check if termination condition is met.
   */
  shouldTerminate(decision: AgentDecision): boolean {
    if (decision.nextStep === "done") {
      return true;
    }

    if (!this.canContinue()) {
      console.log("[termination] Max steps reached");
      return true;
    }

    if (decision.nextStep === "refine" && !this.canRefine()) {
      console.log("[termination] Max refinements reached");
      return true;
    }

    return false;
  }

  /**
   * Reset counters (useful for testing or restarting).
   */
  reset(): void {
    this.stepCount = 0;
    this.refinementCount = 0;
  }

  /**
   * Get current state for debugging.
   */
  getState() {
    return {
      stepCount: this.stepCount,
      maxSteps: this.maxSteps,
      refinementCount: this.refinementCount,
      maxRefinements: this.maxRefinements,
    };
  }
}
