/**
 * Input Validation Utility
 *
 * Provides validation for file paths, task inputs, and sandbox paths.
 * Includes security checks for path traversal and input sanitization.
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Critical errors that prevent proceeding */
  errors: string[];
  /** Non-critical warnings */
  warnings: string[];
}

/**
 * Validation configuration options.
 */
export interface ValidationConfig {
  /** Maximum task description length (default: 10000) */
  maxTaskLength: number;
  /** Maximum file size in MB (default: 10) */
  maxFileSizeMB: number;
  /** Allowed directories for sandbox operations */
  allowedSandboxDirs: string[];
  /** Blocked path patterns for security */
  blockedPatterns: string[];
  /** Allowed file extensions for upload */
  allowedExtensions: string[];
}

/**
 * Default validation configuration.
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxTaskLength: 10000,
  maxFileSizeMB: 10,
  allowedSandboxDirs: ["/home/user/input", "/home/user/output", "/home/user", "/tmp"],
  blockedPatterns: ["../", "/etc/", "/var/", "/root/", "/proc/", "/sys/", "/dev/"],
  allowedExtensions: [
    ".csv", ".json", ".txt", ".py", ".js", ".ts", ".md", ".html",
    ".xml", ".yaml", ".yml", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".svg", ".pdf", ".zip", ".tar", ".gz",
  ],
};

/**
 * Expand ~ to home directory.
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Create an empty validation result.
 */
function createResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

/**
 * Merge multiple validation results.
 */
export function mergeValidationResults(...results: ValidationResult[]): ValidationResult {
  const merged = createResult();
  
  for (const result of results) {
    merged.errors.push(...result.errors);
    merged.warnings.push(...result.warnings);
  }
  
  merged.valid = merged.errors.length === 0;
  return merged;
}

/**
 * Validate a local file path.
 *
 * @param filePath - Path to validate
 * @param config - Validation configuration
 * @returns Validation result with errors and warnings
 */
export async function validateFilePath(
  filePath: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): Promise<ValidationResult> {
  const result = createResult();
  
  if (!filePath || filePath.trim() === "") {
    result.errors.push("File path is empty");
    result.valid = false;
    return result;
  }

  const expandedPath = expandPath(filePath);
  const resolvedPath = path.resolve(expandedPath);

  // Check for path traversal attempts in the original path
  if (filePath.includes("..")) {
    result.warnings.push(`Path contains '..': ${filePath}`);
  }

  try {
    const stats = await fs.stat(resolvedPath);

    if (!stats.isFile()) {
      result.errors.push(`Path is not a file: ${filePath}`);
      result.valid = false;
      return result;
    }

    // Check file size
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > config.maxFileSizeMB) {
      result.errors.push(
        `File too large: ${sizeMB.toFixed(2)}MB exceeds limit of ${config.maxFileSizeMB}MB`
      );
      result.valid = false;
    } else if (sizeMB > config.maxFileSizeMB * 0.8) {
      result.warnings.push(`Large file: ${sizeMB.toFixed(2)}MB (limit: ${config.maxFileSizeMB}MB)`);
    }

    // Check file extension
    const ext = path.extname(resolvedPath).toLowerCase();
    if (config.allowedExtensions.length > 0 && !config.allowedExtensions.includes(ext)) {
      result.warnings.push(
        `Unusual file extension: ${ext}. Allowed: ${config.allowedExtensions.join(", ")}`
      );
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      result.errors.push(`File not found: ${filePath}`);
    } else if (error.code === "EACCES") {
      result.errors.push(`Permission denied: ${filePath}`);
    } else {
      result.errors.push(`Cannot access file: ${error.message}`);
    }
    result.valid = false;
  }

  return result;
}

/**
 * Validate task input string.
 *
 * @param task - Task description to validate
 * @param config - Validation configuration
 * @returns Validation result with errors and warnings
 */
export function validateTaskInput(
  task: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const result = createResult();

  if (!task || task.trim() === "") {
    result.errors.push("Task description is empty");
    result.valid = false;
    return result;
  }

  // Check length
  if (task.length > config.maxTaskLength) {
    result.errors.push(
      `Task too long: ${task.length} chars exceeds limit of ${config.maxTaskLength}`
    );
    result.valid = false;
  } else if (task.length > config.maxTaskLength * 0.8) {
    result.warnings.push(
      `Long task: ${task.length} chars (limit: ${config.maxTaskLength})`
    );
  }

  // Check for control characters (except newlines and tabs)
  const controlCharPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  if (controlCharPattern.test(task)) {
    result.warnings.push("Task contains control characters");
  }

  return result;
}

/**
 * Sanitize a sandbox path to prevent path traversal attacks.
 *
 * @param sandboxPath - Path within the sandbox to sanitize
 * @param config - Validation configuration
 * @returns Sanitized path safe for use in the sandbox
 */
export function sanitizeSandboxPath(
  sandboxPath: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): string {
  if (!sandboxPath) {
    return "/home/user/output/output";
  }

  let sanitized = sandboxPath;

  // Remove any blocked patterns
  for (const pattern of config.blockedPatterns) {
    while (sanitized.includes(pattern)) {
      sanitized = sanitized.replace(pattern, "/");
      log(`[security] Removed blocked pattern '${pattern}' from path`);
    }
  }

  // Normalize the path to resolve any remaining . or ..
  sanitized = path.posix.normalize(sanitized);

  // Ensure path starts with /
  if (!sanitized.startsWith("/")) {
    sanitized = "/" + sanitized;
  }

  // Ensure path is within allowed directories
  const isAllowed = config.allowedSandboxDirs.some((dir) =>
    sanitized.startsWith(dir) || sanitized === dir
  );

  if (!isAllowed) {
    // Default to /home/user/output if path is not in allowed dirs
    const basename = path.posix.basename(sanitized);
    sanitized = `/home/user/output/${basename}`;
    log(`[security] Path redirected to allowed directory: ${sanitized}`);
  }

  return sanitized;
}

/**
 * Validate a sandbox path without modifying it.
 *
 * @param sandboxPath - Path within the sandbox to validate
 * @param config - Validation configuration
 * @returns Validation result with errors and warnings
 */
export function validateSandboxPath(
  sandboxPath: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const result = createResult();

  if (!sandboxPath || sandboxPath.trim() === "") {
    result.errors.push("Sandbox path is empty");
    result.valid = false;
    return result;
  }

  // Check for blocked patterns
  for (const pattern of config.blockedPatterns) {
    if (sandboxPath.includes(pattern)) {
      result.errors.push(`Blocked pattern in path: '${pattern}'`);
      result.valid = false;
    }
  }

  // Check if path is within allowed directories
  const isAllowed = config.allowedSandboxDirs.some((dir) =>
    sandboxPath.startsWith(dir) || sandboxPath === dir
  );

  if (!isAllowed) {
    result.warnings.push(
      `Path not in allowed directories: ${sandboxPath}. ` +
      `Allowed: ${config.allowedSandboxDirs.join(", ")}`
    );
  }

  return result;
}

/**
 * Extract file paths from a task description.
 *
 * @param task - Task description that may contain file paths
 * @returns Array of extracted file paths
 */
export function extractFilePaths(task: string): string[] {
  const paths: string[] = [];

  // Match quoted paths (drag-and-drop style)
  const quotedPattern = /'([^']+)'|"([^"]+)"/g;
  let match;
  while ((match = quotedPattern.exec(task)) !== null) {
    const p = match[1] || match[2];
    if (p && (p.startsWith("/") || p.startsWith("~") || p.startsWith("./"))) {
      paths.push(p);
    }
  }

  // Match file: and output: prefixed paths
  const prefixPattern = /(?:file|output):\s*([^\s,]+)/gi;
  while ((match = prefixPattern.exec(task)) !== null) {
    if (match[1]) {
      paths.push(match[1]);
    }
  }

  // Match common file path patterns (absolute and relative)
  const pathPattern = /(?:^|\s)((?:\/[\w.-]+)+|~\/[\w./-]+|\.\/[\w./-]+)/g;
  while ((match = pathPattern.exec(task)) !== null) {
    if (match[1] && !paths.includes(match[1])) {
      paths.push(match[1]);
    }
  }

  return [...new Set(paths)]; // Remove duplicates
}

/**
 * Validate all file paths mentioned in a task description.
 *
 * @param task - Task description that may contain file paths
 * @param config - Validation configuration
 * @returns Combined validation result for all paths
 */
export async function validateTaskFilePaths(
  task: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): Promise<ValidationResult> {
  const filePaths = extractFilePaths(task);
  
  if (filePaths.length === 0) {
    return createResult();
  }

  const results = await Promise.all(
    filePaths.map((p) => validateFilePath(p, config))
  );

  // Only fail if input files don't exist; output paths are allowed to not exist
  const inputResults: ValidationResult[] = [];
  const outputResults: ValidationResult[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    const p = filePaths[i];
    // Check if it's an output path (contains "output:" or is after "save to")
    const isOutput = task.toLowerCase().includes(`output: ${p}`) ||
                     task.toLowerCase().includes(`output:${p}`) ||
                     task.toLowerCase().includes(`save to ${p}`) ||
                     task.toLowerCase().includes(`save it to ${p}`);
    
    if (isOutput) {
      // For output paths, convert errors about non-existence to warnings
      const result = results[i];
      const adjustedResult = createResult();
      for (const error of result.errors) {
        if (error.includes("not found")) {
          // Output files don't need to exist
          continue;
        }
        adjustedResult.errors.push(error);
      }
      adjustedResult.warnings = [...result.warnings];
      adjustedResult.valid = adjustedResult.errors.length === 0;
      outputResults.push(adjustedResult);
    } else {
      inputResults.push(results[i]);
    }
  }

  return mergeValidationResults(...inputResults, ...outputResults);
}

/**
 * Validate complete task inputs including task description and file paths.
 *
 * @param task - Task description
 * @param config - Validation configuration
 * @returns Combined validation result
 */
export async function validateTaskInputs(
  task: string,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): Promise<ValidationResult> {
  const taskResult = validateTaskInput(task, config);
  const fileResult = await validateTaskFilePaths(task, config);
  
  return mergeValidationResults(taskResult, fileResult);
}
