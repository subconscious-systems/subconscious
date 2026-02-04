/**
 * Database schema.
 * Defines the structure of our database tables.
 * Convex uses this for type-safety and validation.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Todo items the AI agent can manage
  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
    createdAt: v.number(),
  }),

  // Chat history between user and AI
  messages: defineTable({
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
  }),
});
