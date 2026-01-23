import { test, expect } from "bun:test";
import { runAgentWithTask } from "../src/cli/run";

/**
 * Simple test - no file uploads, just code execution
 * Tests that the agent can run Python code in E2B and return results
 */
test("Fibonacci calculation", async () => {
  const taskDescription = "Calculate and print the first 20 fibonacci numbers";
  const context = "Use Python. Print each number on a new line.";

  console.log("\n" + "=".repeat(60));
  console.log("TEST: Fibonacci Calculation (no files)");
  console.log("=".repeat(60));
  console.log(`Task: ${taskDescription}\n`);

  try {
    await runAgentWithTask(taskDescription, context);
    console.log("\n✓ Agent completed successfully");
  } catch (error: any) {
    // Handle expected setup errors gracefully
    if (
      error.message.includes("SUBCONSCIOUS_API_KEY") ||
      error.message.includes("cloudflared not found")
    ) {
      console.warn("\n⚠ Test skipped: Missing required setup");
      console.warn("  - Ensure SUBCONSCIOUS_API_KEY is set");
      console.warn("  - Ensure cloudflared is installed");
      return;
    }
    throw error;
  }
}, 120000); // 2 minute timeout
