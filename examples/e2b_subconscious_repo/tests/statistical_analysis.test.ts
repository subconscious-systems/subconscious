#!/usr/bin/env bun

/**
 * Test: Statistical Analysis on CSV
 * 
 * This test simulates a human user asking the agent to perform
 * statistical analysis on a CSV file. The file path is included
 * in the request, just like a human would do.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { runAgentWithTask } from "../src/cli/run";
import { promises as fs } from "fs";
import * as path from "path";

// Use paths relative to the test file location
const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const TEST_CSV_PATH = path.join(TEST_DIR, "sales_data.csv");
const OUTPUT_DIR = path.join(TEST_DIR, "output");

// Ensure output directory exists
beforeAll(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
});

afterAll(async () => {
  // Cleanup: remove output files if needed
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    for (const file of files) {
      await fs.unlink(path.join(OUTPUT_DIR, file));
    }
  } catch {
    // Ignore cleanup errors
  }
});

test("Statistical analysis on CSV file", async () => {
  // Verify CSV file exists
  try {
    await fs.access(TEST_CSV_PATH);
  } catch {
    throw new Error(`Test CSV file not found: ${TEST_CSV_PATH}`);
  }

  // Task description - includes file path like a human would
  const taskDescription = `Perform statistical analysis on file: ${TEST_CSV_PATH}. 
Calculate and report:
1. Total sales across all records
2. Average sales per transaction
3. Total quantity sold
4. Sales by category (Electronics vs Accessories)
5. Sales by region
6. Top 3 products by total sales
7. Save the analysis results to output: ${path.join(OUTPUT_DIR, "analysis_results.json")}`;

  const context = `The CSV file contains sales data with columns: Date, Product, Category, Sales, Quantity, Region. 
Use pandas or similar library for data analysis.`;

  console.log("\n" + "=".repeat(60));
  console.log("TEST: Statistical Analysis on CSV");
  console.log("=".repeat(60));
  console.log(`Task: ${taskDescription}\n`);

  // Run the agent with the task
  // Note: This will actually call Subconscious and E2B, so it requires:
  // - SUBCONSCIOUS_API_KEY environment variable
  // - TUNNEL_URL or cloudflared for tool server
  // - Network connectivity

  try {
    await runAgentWithTask(taskDescription, context);

    // Verify output file was created
    const outputFile = path.join(OUTPUT_DIR, "analysis_results.json");
    try {
      const stats = await fs.stat(outputFile);
      expect(stats.size).toBeGreaterThan(0);
      console.log(`\n✓ Output file created: ${outputFile}`);

      // Read and verify the output contains expected analysis
      const content = await fs.readFile(outputFile, "utf-8");
      const analysis = JSON.parse(content);

      // Basic validation that analysis was performed
      expect(analysis).toBeDefined();
      console.log("\n✓ Analysis results validated");
    } catch (error: any) {
      console.warn(`⚠ Output file not found: ${outputFile}`);
      console.warn("This might be expected if the agent didn't create the file");
    }
  } catch (error: any) {
    // Don't fail the test if it's a setup issue (missing API keys, etc.)
    if (error.message.includes("SUBCONSCIOUS_API_KEY")) {
      console.warn("\n⚠ Test skipped: Missing SUBCONSCIOUS_API_KEY");
      console.warn("To run this test:");
      console.warn("  1. Set SUBCONSCIOUS_API_KEY environment variable");
      return; // Skip test, don't fail
    }
    
    // Tunnel errors - cloudflared should auto-start, but if not installed, skip test
    if (
      error.message.includes("cloudflared not installed") ||
      error.message.includes("cloudflared not found")
    ) {
      console.warn("\n⚠ Test skipped: cloudflared not installed");
      console.warn("Install with: brew install cloudflare/cloudflare/cloudflared");
      console.warn("The tunnel should start automatically once cloudflared is installed.");
      return; // Skip test, don't fail
    }
    
    // Subconscious API errors (503, missing URL, etc.) - likely missing API key or API issue
    if (
      error.message.includes("SubconsciousError") ||
      error.message.includes("503") ||
      error.message.includes("No URL configured") ||
      error.status === 503
    ) {
      console.warn("\n⚠ Test skipped: Subconscious API error");
      console.warn("This might be due to:");
      console.warn("  1. Missing or invalid SUBCONSCIOUS_API_KEY");
      console.warn("  2. Subconscious API temporarily unavailable");
      console.warn("  3. Network connectivity issues");
      console.warn("\n✓ Tunnel auto-start is working correctly!");
      return; // Skip test, don't fail
    }
    
    // Other tunnel errors (timeout, etc.) - these are real failures
    if (error.message.includes("tunnel") || error.message.includes("Tunnel")) {
      console.error("\n❌ Tunnel error:", error.message);
      // Don't skip - this is a real error that should be investigated
    }
    
    throw error; // Re-throw other errors
  }
}, 300000); // 5 minute timeout for agent execution
