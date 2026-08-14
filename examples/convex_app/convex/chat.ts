/**
 * Chat handler.
 * Connects the frontend to Subconscious via the OpenAI-compatible chat/completions API.
 *
 * When a user sends a message:
 * 1. Save the message to the database
 * 2. Load prior conversation history for multi-turn context
 * 3. Get current todos and build a system prompt
 * 4. Run the tool loop: call chat/completions with standard OpenAI function tools;
 *    if the model returns `tool_calls`, execute each one in-process via
 *    ctx.runMutation / ctx.runQuery, append the results as `role: "tool"`
 *    messages, and repeat until the model returns a final text answer
 * 5. Save and return the assistant response
 *
 * Subconscious is OpenAI-compatible and supports standard function tools, but it
 * does NOT execute tools server-side — we run the loop here and call the todo
 * mutations directly (no callback HTTP endpoints needed).
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { GenericActionCtx, AnyDataModel } from "convex/server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1";
const SUBCONSCIOUS_MODEL = "subconscious/tim-qwen3.6-27b";
const MAX_TOOL_STEPS = 12;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// OpenAI-compatible types (the subset we use)
// ---------------------------------------------------------------------------

interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface MessageParam {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ChatCompletionChoice {
  message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
  finish_reason: string;
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

// ---------------------------------------------------------------------------
// Tool definitions (standard OpenAI function-calling format)
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "addTodo",
      description: "Add a new todo item to the list",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The todo item text" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "completeTodo",
      description: "Mark a todo item as completed",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The todo ID to complete" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "uncompleteTodo",
      description: "Mark a todo item as not completed",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The todo ID to uncomplete" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deleteTodo",
      description: "Delete a todo item permanently",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The todo ID to delete" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clearCompleted",
      description: "Remove all completed todos from the list",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "listTodos",
      description: "Get the current list of all todos",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResponse(message: string, status: number, details?: string): Response {
  const body: Record<string, string> = { error: message };
  if (details !== undefined) {
    body.details = details;
  }
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function getStringEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function narrowErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Tool executor — runs a single tool call against the Convex database
// ---------------------------------------------------------------------------

async function executeTool(
  ctx: GenericActionCtx<AnyDataModel>,
  toolName: string,
  rawArgs: unknown
): Promise<unknown> {
  const args =
    typeof rawArgs === "object" && rawArgs !== null
      ? (rawArgs as Record<string, unknown>)
      : {};

  switch (toolName) {
    case "addTodo": {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text) return { error: "Missing required parameter: text" };
      return await ctx.runMutation(api.todos.add, { text });
    }
    case "completeTodo": {
      const id = typeof args.id === "string" ? args.id : "";
      if (!id) return { error: "Missing required parameter: id" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await ctx.runMutation(api.todos.complete, { id } as any);
    }
    case "uncompleteTodo": {
      const id = typeof args.id === "string" ? args.id : "";
      if (!id) return { error: "Missing required parameter: id" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await ctx.runMutation(api.todos.uncomplete, { id } as any);
    }
    case "deleteTodo": {
      const id = typeof args.id === "string" ? args.id : "";
      if (!id) return { error: "Missing required parameter: id" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await ctx.runMutation(api.todos.remove, { id } as any);
    }
    case "clearCompleted": {
      return await ctx.runMutation(api.todos.clearCompleted, {});
    }
    case "listTodos": {
      const todos = await ctx.runQuery(api.todos.list, {});
      return { todos };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Single chat/completions call
// ---------------------------------------------------------------------------

async function callChatCompletions(
  apiKey: string,
  messages: MessageParam[]
): Promise<ChatCompletionResponse> {
  const res = await fetch(`${SUBCONSCIOUS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: SUBCONSCIOUS_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      // Disable the thinking preamble so the assistant replies concisely.
      // Subconscious thinking is ON by default; pass false for user-facing chat.
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Subconscious API error (${res.status}): ${text}`);
  }

  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as Record<string, unknown>).choices)
  ) {
    throw new Error("Unexpected response shape from Subconscious API");
  }
  return data as ChatCompletionResponse;
}

// ---------------------------------------------------------------------------
// HTTP action
// ---------------------------------------------------------------------------

export const chat = httpAction(async (ctx, request) => {
  try {
    // --- Parse request -------------------------------------------------------
    let userMessage: string;
    try {
      const body: unknown = await request.json();
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as Record<string, unknown>).message !== "string"
      ) {
        return errorResponse("Missing or invalid 'message' field in request body", 400);
      }
      userMessage = (body as Record<string, string>).message;
      if (!userMessage.trim()) {
        return errorResponse("'message' must not be empty", 400);
      }
    } catch (err) {
      return errorResponse("Invalid JSON in request body", 400, narrowErrorMessage(err));
    }

    // --- Validate env vars ---------------------------------------------------
    const apiKey = getStringEnv("SUBCONSCIOUS_API_KEY");
    if (!apiKey) {
      console.error("SUBCONSCIOUS_API_KEY environment variable not set in Convex Dashboard");
      return errorResponse(
        "SUBCONSCIOUS_API_KEY environment variable not set",
        500,
        "Set SUBCONSCIOUS_API_KEY in Convex Dashboard > Settings > Environment Variables"
      );
    }

    // --- Persist user message ------------------------------------------------
    await ctx.runMutation(api.messages.send, { role: "user", content: userMessage });

    // --- Load conversation history for multi-turn context --------------------
    // All but the last message — we just inserted the user turn above.
    const history = await ctx.runQuery(api.messages.list, {});
    const priorMessages = history.slice(0, -1);

    // --- Load current todos for the system prompt ----------------------------
    const todos = await ctx.runQuery(api.todos.list, {});
    const todoList =
      todos.length === 0
        ? "No todos yet."
        : todos
            .map(
              (t: { completed: boolean; text: string; _id: string }) =>
                `- [${t.completed ? "x" : " "}] ${t.text} (id: ${t._id})`
            )
            .join("\n");

    const systemPrompt = `You are a helpful todo list assistant. Help users manage their todos.

Current todos:
${todoList}

When the user asks to add, complete, uncomplete, or remove todos, use the provided tools.
Be concise. After using a tool, briefly confirm what you did.
For listing todos, you can either use the listTodos tool or describe the current state from context.`;

    // --- Build initial messages array ----------------------------------------
    const messages: MessageParam[] = [
      { role: "system", content: systemPrompt },
      ...priorMessages.map(
        (m: { role: string; content: string }): MessageParam => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })
      ),
      { role: "user", content: userMessage },
    ];

    // --- Tool loop: call model, run any tool_calls, repeat -------------------
    let assistantMessage = "I couldn't process that request.";

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      let completion: ChatCompletionResponse;
      try {
        completion = await callChatCompletions(apiKey, messages);
      } catch (err) {
        console.error("Subconscious API call failed:", narrowErrorMessage(err));
        return errorResponse("Failed to call Subconscious API", 500, narrowErrorMessage(err));
      }

      const choice = completion.choices[0];
      if (!choice) {
        return errorResponse("Subconscious API returned no choices", 500);
      }

      const responseMessage = choice.message;
      const toolCalls = responseMessage.tool_calls;

      // No tool calls — this is the final answer.
      if (!toolCalls || toolCalls.length === 0) {
        assistantMessage = responseMessage.content ?? "I couldn't process that request.";
        break;
      }

      // Record the assistant turn that requested the tools.
      messages.push({
        role: "assistant",
        content: responseMessage.content ?? "",
        tool_calls: toolCalls,
      });

      // Execute each requested tool and feed the results back.
      for (const toolCall of toolCalls) {
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments) as unknown;
        } catch {
          parsedArgs = {};
        }

        let toolResult: unknown;
        try {
          toolResult = await executeTool(ctx, toolCall.function.name, parsedArgs);
        } catch (err) {
          toolResult = { error: narrowErrorMessage(err) };
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    // --- Persist and return assistant response --------------------------------
    await ctx.runMutation(api.messages.send, { role: "assistant", content: assistantMessage });

    return new Response(JSON.stringify({ message: assistantMessage }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error("Unexpected error in chat handler:", narrowErrorMessage(err));
    return errorResponse("Internal server error", 500, narrowErrorMessage(err));
  }
});
