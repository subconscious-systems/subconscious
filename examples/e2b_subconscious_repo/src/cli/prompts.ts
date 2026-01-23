import * as readline from "readline";
import { promises as fs } from "fs";
import * as path from "path";

/**
 * Interactive Prompts
 * 
 * Rich prompts for file selection and user interaction.
 */

/**
 * Prompt for file selection if no file path is specified.
 */
export async function promptFileSelection(
  rl: readline.Interface,
  question: string
): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(question, async (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }

      // Check if file exists
      try {
        await fs.access(trimmed);
        resolve(trimmed);
      } catch {
        console.log(`File not found: ${trimmed}`);
        resolve(null);
      }
    });
  });
}

/**
 * Confirm large file upload.
 */
export async function confirmLargeFileUpload(
  rl: readline.Interface,
  filePath: string,
  sizeMB: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const question = `File is large (${sizeMB.toFixed(2)}MB). Upload? (y/n): `;
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

/**
 * Prompt for output file name.
 */
export async function promptOutputFileName(
  rl: readline.Interface,
  defaultName: string
): Promise<string> {
  return new Promise((resolve) => {
    const question = `Output file name (default: ${defaultName}): `;
    rl.question(question, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || defaultName);
    });
  });
}

/**
 * Display file upload progress (simple version).
 */
export function showUploadProgress(fileName: string, current: number, total: number): void {
  const percentage = Math.round((current / total) * 100);
  process.stdout.write(`\r[file] Uploading ${fileName}: ${percentage}%`);
  if (current === total) {
    process.stdout.write("\n");
  }
}
