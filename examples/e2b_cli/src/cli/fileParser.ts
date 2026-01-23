import * as path from "path";
import { promises as fs } from "fs";

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
  const processedPaths = new Set<string>();

  // Pattern 1: file: ./path/to/file.csv
  const filePattern = /file:\s*([^\s\n]+)/gi;
  let match;

  const fileMatches = description.match(filePattern);
  if (fileMatches) {
    console.log(
      `[file] Found ${fileMatches.length} file: pattern(s) in description`
    );
  }

  while ((match = filePattern.exec(description)) !== null) {
    let filePath = match[1].trim().replace(/[.,;:!?]+$/, "");
    if (processedPaths.has(filePath)) continue;
    processedPaths.add(filePath);

    const resolvedPath = path.resolve(filePath);
    const exists = await fileExists(resolvedPath);

    console.log(
      `[file] Checking: ${filePath} -> ${resolvedPath} (exists: ${exists})`
    );

    if (exists) {
      const fileName = path.basename(resolvedPath);
      const sandboxPath = `/home/user/input/${fileName}`;

      files.push({
        localPath: resolvedPath,
        sandboxPath,
        type: "input",
      });

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

      updatedDescription = updatedDescription.replace(
        match[0],
        `files: /home/user/input/`
      );
    } catch {
      console.log(`[file] Warning: Could not read directory: ${dir}`);
    }
  }

  // Pattern 3: output: ./results.json
  const outputPattern = /output:\s*([^\s\n]+)/gi;
  const textsToParse = [description];
  if (context) textsToParse.push(context);

  const processedOutputPaths = new Set<string>();

  for (const text of textsToParse) {
    let outputMatch;
    while ((outputMatch = outputPattern.exec(text)) !== null) {
      let filePath = outputMatch[1].trim().replace(/[.,;:!?]+$/, "");

      if (processedOutputPaths.has(filePath)) continue;
      processedOutputPaths.add(filePath);

      const resolvedPath = path.resolve(filePath);
      const fileName = path.basename(resolvedPath);
      const sandboxPath = `/home/user/output/${fileName}`;

      files.push({
        localPath: resolvedPath,
        sandboxPath,
        type: "output",
      });

      if (text === description) {
        updatedDescription = updatedDescription.replace(
          outputMatch[0],
          `output: ${sandboxPath}`
        );
      }
    }
    outputPattern.lastIndex = 0;
  }

  return { files, updatedDescription };
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
