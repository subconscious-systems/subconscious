/**
 * Tool executor — dispatches model tool calls to the E2B sandbox.
 *
 * The agent loop calls `executeTool(name, args, sandbox)` and feeds the result
 * back as the next user message. No HTTP server or tunnel is needed.
 */

import * as path from "path";
import * as os from "os";
import { promises as fs } from "fs";
import type { E2BSandbox, SupportedLanguage } from "../e2b/sandbox.js";
import {
  sanitizeSandboxPath,
  validateSandboxPath,
} from "../utils/validation.js";
import type { ValidationConfig } from "../utils/validation.js";
import { defaultConfig } from "../config.js";

/** Expand `~` to the real home directory. */
function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/** Common extensions tried when fuzzy-matching a file path. */
const FUZZY_EXTENSIONS = [
  ".md", ".txt", ".csv", ".json", ".py", ".js", ".ts", ".html",
  ".xml", ".yaml", ".yml", ".pdf", ".png", ".jpg", ".jpeg", ".gif",
];

/**
 * Try to locate a file, optionally adding common extensions or prefix-matching
 * siblings in the same directory. Returns the resolved path and stats on success.
 */
async function fuzzyFindFile(
  filePath: string,
): Promise<{ matchedPath: string; stats: Awaited<ReturnType<typeof fs.stat>>; fuzzyMatch: boolean } | null> {
  // 1. Exact path
  try {
    const stats = await fs.stat(filePath);
    return { matchedPath: filePath, stats, fuzzyMatch: false };
  } catch {
    // fall through
  }

  // 2. Append common extensions (only when no extension present)
  if (!path.extname(filePath)) {
    for (const ext of FUZZY_EXTENSIONS) {
      try {
        const candidate = filePath + ext;
        const stats = await fs.stat(candidate);
        if (stats.isFile()) {
          return { matchedPath: candidate, stats, fuzzyMatch: true };
        }
      } catch {
        // try next
      }
    }
  }

  // 3. Prefix-match siblings in the parent directory
  const dirname = path.dirname(filePath);
  const basename = path.basename(filePath);
  try {
    const siblings = await fs.readdir(dirname);
    const matches = siblings
      .filter((f) => f.startsWith(basename) && f !== basename)
      .sort((a, b) => a.length - b.length);
    for (const match of matches) {
      try {
        const candidate = path.join(dirname, match);
        const stats = await fs.stat(candidate);
        if (stats.isFile()) {
          return { matchedPath: candidate, stats, fuzzyMatch: true };
        }
      } catch {
        // try next
      }
    }
  } catch {
    // directory unreadable
  }

  return null;
}

/** Narrow raw args to the shape expected by execute_code. */
interface ExecuteCodeArgs {
  code: string;
  language?: string;
  timeout?: number;
}

/** Narrow raw args to the shape expected by upload_local_file. */
interface UploadLocalFileArgs {
  local_path: string;
  sandbox_path?: string;
}

/** Narrow raw args to the shape expected by download_file. */
interface DownloadFileArgs {
  sandbox_path: string;
  local_path: string;
}

/** Narrow raw args to the shape expected by check_local_file. */
interface CheckLocalFileArgs {
  path: string;
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid argument: "${name}" must be a non-empty string`);
  }
  return value;
}

/**
 * Execute a tool call on behalf of the agent loop.
 *
 * @returns A plain-string description of the result that will be fed back to the model.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  sandbox: E2BSandbox,
  validationConfig: ValidationConfig = defaultConfig.validation,
): Promise<string> {
  switch (toolName) {
    case "execute_code": {
      const code = assertString(args["code"], "code");
      const language = (typeof args["language"] === "string" ? args["language"] : "python") as SupportedLanguage;
      const timeoutSecs = typeof args["timeout"] === "number" ? args["timeout"] : undefined;
      const timeoutMs = timeoutSecs !== undefined ? timeoutSecs * 1000 : undefined;

      const result = await sandbox.executeCode(code, language, timeoutMs);
      const lines: string[] = [
        `success: ${result.success}`,
        `exitCode: ${result.exitCode}`,
        `duration: ${result.duration ?? 0}ms`,
      ];
      if (result.stdout) lines.push(`stdout:\n${result.stdout}`);
      if (result.stderr) lines.push(`stderr:\n${result.stderr}`);
      if (result.timeout) lines.push("timed out: true");
      return lines.join("\n");
    }

    case "upload_local_file": {
      const rawArgs = args as unknown as UploadLocalFileArgs;
      const rawLocalPath = assertString(rawArgs.local_path, "local_path");
      const resolvedLocalPath = path.resolve(expandPath(rawLocalPath));

      const found = await fuzzyFindFile(resolvedLocalPath);
      if (!found) {
        return `error: File not found: ${rawLocalPath}`;
      }
      const { matchedPath, stats, fuzzyMatch } = found;

      if (!stats.isFile()) {
        return `error: Path is not a file: ${matchedPath}`;
      }

      const fileName = path.basename(matchedPath);
      const rawSandboxPath = rawArgs.sandbox_path ?? `/home/user/input/${fileName}`;
      const sanitizedSandboxPath = sanitizeSandboxPath(rawSandboxPath, validationConfig);

      const validation = validateSandboxPath(sanitizedSandboxPath, validationConfig);
      if (!validation.valid) {
        return `error: Invalid sandbox path: ${validation.errors.join(", ")}`;
      }

      await sandbox.uploadFile(matchedPath, sanitizedSandboxPath);

      const fileSize = Number(stats.size);
      const sizeMB = fileSize / (1024 * 1024);
      const sizeStr = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(fileSize / 1024).toFixed(1)} KB`;
      const fuzzyNote = fuzzyMatch ? ` (fuzzy matched from "${rawLocalPath}")` : "";
      return `success: true\nUploaded ${fileName}${fuzzyNote} to ${sanitizedSandboxPath} (${sizeStr})`;
    }

    case "download_file": {
      const rawArgs = args as unknown as DownloadFileArgs;
      const rawSandboxPath = assertString(rawArgs.sandbox_path, "sandbox_path");
      const rawLocalPath = assertString(rawArgs.local_path, "local_path");

      const sanitizedSandboxPath = sanitizeSandboxPath(rawSandboxPath, validationConfig);
      const validation = validateSandboxPath(sanitizedSandboxPath, validationConfig);
      if (!validation.valid) {
        return `error: Invalid sandbox path: ${validation.errors.join(", ")}`;
      }

      const localPath = path.resolve(expandPath(rawLocalPath));
      await sandbox.downloadFile(sanitizedSandboxPath, localPath);

      const stats = await fs.stat(localPath);
      const sizeMB = stats.size / (1024 * 1024);
      const sizeStr = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(1)} KB`;
      return `success: true\nDownloaded ${sanitizedSandboxPath} → ${rawLocalPath} (${sizeStr})`;
    }

    case "check_local_file": {
      const rawArgs = args as unknown as CheckLocalFileArgs;
      const rawPath = assertString(rawArgs.path, "path");
      const resolvedPath = path.resolve(expandPath(rawPath));

      const found = await fuzzyFindFile(resolvedPath);
      if (!found) {
        return "exists: false";
      }
      const { matchedPath, stats, fuzzyMatch } = found;
      const lines = [
        "exists: true",
        `is_file: ${stats.isFile()}`,
        `is_directory: ${stats.isDirectory()}`,
        `size: ${stats.size} bytes`,
      ];
      if (fuzzyMatch) {
        lines.push(`matched_path: ${matchedPath}`);
        lines.push("fuzzy_match: true");
      }
      return lines.join("\n");
    }

    default:
      return `error: Unknown tool "${toolName}"`;
  }
}
