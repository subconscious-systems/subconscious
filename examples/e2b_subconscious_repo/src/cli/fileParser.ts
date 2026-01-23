import * as path from "path";
import { promises as fs } from "fs";
import type { AgentTask } from "../types/agent";

/**
 * File Reference Parser
 * 
 * Parses file references from task descriptions and validates file existence.
 * Supports patterns like:
 * - file: ./path/to/file.csv
 * - files: ./dir/*.csv
 * - output: ./results.json
 */

export interface ParsedFile {
  localPath: string;
  sandboxPath: string;
  type: "input" | "output";
}

export interface FileParseResult {
  files: ParsedFile[];
  updatedDescription: string;
}

/**
 * Parse file references from task description.
 */
export async function parseFileReferences(
  description: string,
  context?: string
): Promise<FileParseResult> {
  const files: ParsedFile[] = [];
  let updatedDescription = description;

  // Pattern 1: file: ./path/to/file.csv or file:path/to/file.csv
  // Match file: followed by path (can include spaces if quoted, or until whitespace/newline)
  const filePattern = /file:\s*([^\s\n]+)/gi;
  let match;
  const processedPaths = new Set<string>();

  while ((match = filePattern.exec(description)) !== null) {
    let filePath = match[1].trim();
    // Remove trailing punctuation that might be part of the sentence
    filePath = filePath.replace(/[.,;:!?]+$/, "");
    if (processedPaths.has(filePath)) continue;
    processedPaths.add(filePath);

    const resolvedPath = path.resolve(filePath);
    const exists = await fileExists(resolvedPath);

    if (exists) {
      const fileName = path.basename(resolvedPath);
      const sandboxPath = `/home/user/input/${fileName}`;

      files.push({
        localPath: resolvedPath,
        sandboxPath,
        type: "input",
      });

      // Replace in description with sandbox path
      updatedDescription = updatedDescription.replace(
        match[0],
        `file: ${sandboxPath}`
      );
    } else {
      console.log(`[file] Warning: File not found: ${filePath}`);
    }
  }

  // Pattern 2: files: ./dir/*.csv (wildcard support)
  const filesPattern = /files:\s*([^\s]+)/gi;
  while ((match = filesPattern.exec(description)) !== null) {
    const pattern = match[1].trim();
    const resolvedPattern = path.resolve(pattern);
    const dir = path.dirname(resolvedPattern);
    const glob = path.basename(resolvedPattern);

    try {
      const dirFiles = await fs.readdir(dir);
      const regex = new RegExp(
        "^" + glob.replace(/\*/g, ".*").replace(/\./g, "\\.")
      );

      for (const file of dirFiles) {
        if (regex.test(file)) {
          const filePath = path.join(dir, file);
          const resolvedPath = path.resolve(filePath);
          const exists = await fileExists(resolvedPath);

          if (exists) {
            const sandboxPath = `/home/user/input/${file}`;

            files.push({
              localPath: resolvedPath,
              sandboxPath,
              type: "input",
            });
          }
        }
      }

      // Replace pattern in description
      updatedDescription = updatedDescription.replace(
        match[0],
        `files: /home/user/input/`
      );
    } catch (error) {
      console.log(`[file] Warning: Could not read directory: ${dir}`);
    }
  }

  // Pattern 3: output: ./results.json (output file specification)
  const outputPattern = /output:\s*([^\s]+)/gi;
  while ((match = outputPattern.exec(description)) !== null) {
    const filePath = match[1].trim();
    const resolvedPath = path.resolve(filePath);
    const fileName = path.basename(resolvedPath);
    const sandboxPath = `/home/user/output/${fileName}`;

    files.push({
      localPath: resolvedPath,
      sandboxPath,
      type: "output",
    });

    // Replace in description with sandbox path
    updatedDescription = updatedDescription.replace(
      match[0],
      `output: ${sandboxPath}`
    );
  }

  // Note: Context file parsing removed to avoid infinite recursion
  // Files should be specified in the main task description

  return {
    files,
    updatedDescription,
  };
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
