/**
 * HTTP router.
 * Exposes the /chat endpoint the React frontend calls when a user sends a message.
 *
 * Tools are no longer HTTP endpoints: Subconscious has no server-side function
 * calling, so the chat handler runs the tool loop itself and executes todo
 * mutations in-process (see chat.ts).
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
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

// Chat endpoint (called by the React frontend)
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
