import { promises as fs } from "fs";
import * as path from "path";

/**
 * Output Manager
 * 
 * Manages output directory structure and handles file naming conflicts.
 */

const DEFAULT_OUTPUT_DIR = "./output";

/**
 * Get or create output directory with timestamp.
 */
export async function getOutputDirectory(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(DEFAULT_OUTPUT_DIR, timestamp);

  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

/**
 * Resolve output file path, handling conflicts.
 */
export async function resolveOutputPath(
  filename: string,
  baseDir?: string
): Promise<string> {
  const dir = baseDir || (await getOutputDirectory());
  let filePath = path.join(dir, filename);
  let counter = 1;

  // Handle naming conflicts
  while (await fileExists(filePath)) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    const newFilename = `${name}_${counter}${ext}`;
    filePath = path.join(dir, newFilename);
    counter++;
  }

  return filePath;
}

/**
 * Check if file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract file paths from stdout (common patterns).
 */
export function extractFilePaths(stdout: string): string[] {
  const filePaths: string[] = [];

  // Pattern 1: "Saved to: /path/to/file"
  const savedPattern = /saved\s+to:\s*([^\s\n]+)/gi;
  let match;
  while ((match = savedPattern.exec(stdout)) !== null) {
    filePaths.push(match[1].trim());
  }

  // Pattern 2: "File created: /path/to/file"
  const createdPattern = /file\s+created:\s*([^\s\n]+)/gi;
  while ((match = createdPattern.exec(stdout)) !== null) {
    filePaths.push(match[1].trim());
  }

  // Pattern 3: "Output written to: /path/to/file"
  const outputPattern = /output\s+written\s+to:\s*([^\s\n]+)/gi;
  while ((match = outputPattern.exec(stdout)) !== null) {
    filePaths.push(match[1].trim());
  }

  // Pattern 4: Absolute paths that look like files
  const absolutePathPattern = /(\/[^\s\n]+\.[a-zA-Z0-9]+)/g;
  while ((match = absolutePathPattern.exec(stdout)) !== null) {
    const filePath = match[1].trim();
    // Filter out common non-file paths
    if (
      !filePath.includes("python") &&
      !filePath.includes("node") &&
      !filePath.includes("exec") &&
      filePath.includes(".")
    ) {
      filePaths.push(filePath);
    }
  }

  return [...new Set(filePaths)]; // Remove duplicates
}
