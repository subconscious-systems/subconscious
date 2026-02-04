/**
 * Message queries and mutations.
 * Manages chat history between user and AI.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Returns all messages in order (oldest first)
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("asc").collect();
  },
});

// Saves a new message
export const send = mutation({
  args: {
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, { role, content }) => {
    await ctx.db.insert("messages", {
      role,
      content,
      createdAt: Date.now(),
    });
  },
});

// Clears all messages
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query("messages").collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
  },
});
