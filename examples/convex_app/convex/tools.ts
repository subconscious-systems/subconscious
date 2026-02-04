/**
 * HTTP tool endpoints.
 * These are called by Subconscious when the AI decides to use a tool.
 *
 * Flow:
 * 1. User says "Add buy milk to my list"
 * 2. Subconscious AI decides to call the "addTodo" tool
 * 3. Subconscious makes an HTTP POST to this endpoint
 * 4. This code runs the mutation to add the todo
 * 5. The response tells the AI what happened
 *
 * Subconscious sends: { tool_name, parameters: {...}, request_id }
 * We extract values from body.parameters.
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

// POST /tools/addTodo
export const addTodo = httpAction(async (ctx, request) => {
  const body = await request.json();
  const text = body.parameters?.text;

  if (!text) {
    return new Response(JSON.stringify({ error: "Missing text parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(api.todos.add, { text });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /tools/completeTodo
export const completeTodo = httpAction(async (ctx, request) => {
  const body = await request.json();
  const id = body.parameters?.id;

  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(api.todos.complete, { id });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /tools/uncompleteTodo
export const uncompleteTodo = httpAction(async (ctx, request) => {
  const body = await request.json();
  const id = body.parameters?.id;

  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(api.todos.uncomplete, { id });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /tools/deleteTodo
export const deleteTodo = httpAction(async (ctx, request) => {
  const body = await request.json();
  const id = body.parameters?.id;

  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await ctx.runMutation(api.todos.remove, { id });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /tools/clearCompleted
export const clearCompleted = httpAction(async (ctx) => {
  const result = await ctx.runMutation(api.todos.clearCompleted, {});
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /tools/listTodos
export const listTodos = httpAction(async (ctx) => {
  const todos = await ctx.runQuery(api.todos.list, {});
  return new Response(JSON.stringify({ todos }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
