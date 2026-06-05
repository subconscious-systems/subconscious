/**
 * E2B tool definitions as native OpenAI function tools.
 *
 * Each entry is a standard `ChatCompletionTool` that the Subconscious endpoint
 * accepts via the `tools` field. The agent loop dispatches calls to the
 * matching E2B operation; no HTTP server or tunnel is required.
 */

import type OpenAI from "openai";

export type E2BTool = OpenAI.Chat.Completions.ChatCompletionTool;

export const E2B_TOOLS: E2BTool[] = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Execute code in an isolated E2B sandbox. Supports Python, JavaScript, " +
        "TypeScript, C++, C, Go, Rust, Ruby, Java, and Bash. Returns stdout, " +
        "stderr, exit code, and duration. Files can be read/written at paths like " +
        "/home/user/input/ (for uploaded files) and /home/user/output/ (for generated files).",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Code to execute",
          },
          language: {
            type: "string",
            enum: [
              "python",
              "bash",
              "javascript",
              "typescript",
              "cpp",
              "c",
              "go",
              "rust",
              "ruby",
              "java",
            ],
            description: "Programming language. Use 'cpp' for C++. Defaults to python.",
          },
          timeout: {
            type: "number",
            description: "Timeout in seconds (default: 300)",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upload_local_file",
      description:
        "Upload a file from the user's local machine to the sandbox. Use this when " +
        "the user mentions a file path (like /Users/name/data.csv or ~/Desktop/file.txt) " +
        "that needs to be analyzed or processed. The file will be available in the sandbox " +
        "at the specified sandbox_path (defaults to /home/user/input/<filename>). " +
        "For multiple files, upload them one at a time.",
      parameters: {
        type: "object",
        properties: {
          local_path: {
            type: "string",
            description:
              "Path to the file on the user's local machine. Supports absolute paths " +
              "(e.g., /Users/name/data.csv) and ~ for home directory (e.g., ~/Desktop/file.txt).",
          },
          sandbox_path: {
            type: "string",
            description:
              "Optional. Destination path in the sandbox. Defaults to /home/user/input/<filename>.",
          },
        },
        required: ["local_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_file",
      description:
        "Download a file from the sandbox to the user's local machine. Use this to save " +
        "outputs like charts, reports, processed data, etc. that the user wants to keep. " +
        "Call this after generating files in the sandbox that the user requested.",
      parameters: {
        type: "object",
        properties: {
          sandbox_path: {
            type: "string",
            description:
              "Path to the file in the sandbox (e.g., /home/user/output/chart.png).",
          },
          local_path: {
            type: "string",
            description:
              "Destination path on the user's local machine. Supports absolute paths " +
              "and ~ for home directory. Relative paths save to current working directory.",
          },
        },
        required: ["sandbox_path", "local_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_local_file",
      description:
        "Check if a file exists on the user's local machine and get its info. Use this " +
        "to verify file paths before attempting to upload them.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to check on the user's local machine. Supports ~ for home directory.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
];
