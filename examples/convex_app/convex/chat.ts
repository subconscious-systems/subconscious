/**
 * Chat handler.
 * Connects the frontend to Subconscious.
 *
 * When a user sends a message:
 * 1. Save the message to the database
 * 2. Get current todos for context
 * 3. Define the tools the AI can use (with HTTP URLs)
 * 4. Call the Subconscious API
 * 5. Wait for the AI to finish (it may call tools)
 * 6. Save and return the response
 *
 * The tools point to our /tools/* endpoints. When Subconscious decides
 * to use a tool, it makes an HTTP request to that URL. The endpoint
 * runs the mutation, the database updates, and React components
 * subscribed via useQuery() update automatically.
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const chat = httpAction(async (ctx, request) => {
  const { message } = await request.json();

  // Save user message
  await ctx.runMutation(api.messages.send, { role: "user", content: message });

  // Get current todos for context
  const todos = await ctx.runQuery(api.todos.list, {});

  const todoList =
    todos.length === 0
      ? "No todos yet."
      : todos
          .map(
            (t) => `- [${t.completed ? "x" : " "}] ${t.text} (id: ${t._id})`
          )
          .join("\n");

  // Build prompt with context
  const instructions = `You are a helpful todo list assistant. Help users manage their todos.

Current todos:
${todoList}

User request: ${message}

When the user asks to add, complete, uncomplete, or remove todos, use the provided tools.
Be concise. After using a tool, briefly confirm what you did.
For listing todos, you can either use the listTodos tool or just describe the current state from context.`;

  // Get environment variables
  // CONVEX_URL can be either .cloud or .site - we convert to .site for HTTP endpoints
  const CONVEX_URL_RAW = process.env.CONVEX_URL;

  if (!CONVEX_URL_RAW) {
    return new Response(
      JSON.stringify({ error: "CONVEX_URL environment variable not set" }),
      { status: 500, headers: corsHeaders }
    );
  }

  // Convert .cloud to .site for HTTP endpoints
  const CONVEX_URL = CONVEX_URL_RAW.replace(".cloud", ".site");

  // Define tools with HTTP URLs pointing to our endpoints
  const tools = [
    {
      type: "function" as const,
      name: "addTodo",
      description: "Add a new todo item to the list",
      url: `${CONVEX_URL}/tools/addTodo`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The todo item text" },
        },
        required: ["text"],
      },
    },
    {
      type: "function" as const,
      name: "completeTodo",
      description: "Mark a todo item as completed",
      url: `${CONVEX_URL}/tools/completeTodo`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The todo ID to complete" },
        },
        required: ["id"],
      },
    },
    {
      type: "function" as const,
      name: "uncompleteTodo",
      description: "Mark a todo item as not completed",
      url: `${CONVEX_URL}/tools/uncompleteTodo`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The todo ID to uncomplete" },
        },
        required: ["id"],
      },
    },
    {
      type: "function" as const,
      name: "deleteTodo",
      description: "Delete a todo item permanently",
      url: `${CONVEX_URL}/tools/deleteTodo`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The todo ID to delete" },
        },
        required: ["id"],
      },
    },
    {
      type: "function" as const,
      name: "clearCompleted",
      description: "Remove all completed todos from the list",
      url: `${CONVEX_URL}/tools/clearCompleted`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function" as const,
      name: "listTodos",
      description: "Get the current list of all todos",
      url: `${CONVEX_URL}/tools/listTodos`,
      method: "POST" as const,
      timeout: 10,
      parameters: {
        type: "object",
        properties: {},
      },
    },
  ];

  // Call Subconscious API
  const SUBCONSCIOUS_API_KEY = process.env.SUBCONSCIOUS_API_KEY;

  if (!SUBCONSCIOUS_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "SUBCONSCIOUS_API_KEY environment variable not set",
      }),
      { status: 500, headers: corsHeaders }
    );
  }

  const createResponse = await fetch(
    "https://api.subconscious.dev/v1/runs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUBCONSCIOUS_API_KEY}`,
      },
      body: JSON.stringify({
        engine: "tim-gpt",
        input: {
          instructions,
          tools,
        },
      }),
    }
  );

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error("Subconscious API error (create):", error);
    return new Response(
      JSON.stringify({ error: "Failed to create run" }),
      { status: 500, headers: corsHeaders }
    );
  }

  const { runId } = await createResponse.json();

  // Poll for completion
  let run;
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    const pollResponse = await fetch(
      `https://api.subconscious.dev/v1/runs/${runId}`,
      {
        headers: {
          Authorization: `Bearer ${SUBCONSCIOUS_API_KEY}`,
        },
      }
    );

    if (!pollResponse.ok) {
      const error = await pollResponse.text();
      console.error("Subconscious API error (poll):", error);
      return new Response(
        JSON.stringify({ error: "Failed to poll run" }),
        { status: 500, headers: corsHeaders }
      );
    }

    run = await pollResponse.json();

    if (
      run.status === "succeeded" ||
      run.status === "failed" ||
      run.status === "canceled" ||
      run.status === "timed_out"
    ) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!run || run.status !== "succeeded") {
    return new Response(
      JSON.stringify({ error: "Run timed out or failed" }),
      { status: 500, headers: corsHeaders }
    );
  }

  // Save and return response
  const assistantMessage =
    run.result?.answer || "I couldn't process that request.";

  await ctx.runMutation(api.messages.send, {
    role: "assistant",
    content: assistantMessage,
  });

  return new Response(JSON.stringify({ message: assistantMessage }), {
    status: 200,
    headers: corsHeaders,
  });
});
