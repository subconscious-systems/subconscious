/**
 * HTTP router.
 * Sets up all HTTP endpoints for the Convex backend.
 *
 * Two types of endpoints:
 * 1. /chat - Called by React frontend when user sends a message
 * 2. /tools/* - Called by Subconscious when the AI uses tools
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import {
  addTodo,
  completeTodo,
  uncompleteTodo,
  deleteTodo,
  clearCompleted,
  listTodos,
} from "./tools";
import { chat } from "./chat";

const http = httpRouter();

// CORS headers for browser requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const corsPreflightHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
});

// Tool endpoints (called by Subconscious)
http.route({
  path: "/tools/addTodo",
  method: "POST",
  handler: addTodo,
});

http.route({
  path: "/tools/completeTodo",
  method: "POST",
  handler: completeTodo,
});

http.route({
  path: "/tools/uncompleteTodo",
  method: "POST",
  handler: uncompleteTodo,
});

http.route({
  path: "/tools/deleteTodo",
  method: "POST",
  handler: deleteTodo,
});

http.route({
  path: "/tools/clearCompleted",
  method: "POST",
  handler: clearCompleted,
});

http.route({
  path: "/tools/listTodos",
  method: "POST",
  handler: listTodos,
});

// Chat endpoint (called by React frontend)
http.route({
  path: "/chat",
  method: "POST",
  handler: chat,
});

http.route({
  path: "/chat",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

export default http;
