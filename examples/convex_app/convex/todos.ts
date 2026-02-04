/**
 * Todo queries and mutations.
 *
 * Queries read data, mutations write data.
 * When a mutation runs, React components using related queries
 * automatically re-render with the new data.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Returns all todos, newest first
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("todos").order("desc").collect();
  },
});

// Creates a new todo
export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const id = await ctx.db.insert("todos", {
      text,
      completed: false,
      createdAt: Date.now(),
    });
    return { success: true, id, message: `Added "${text}" to your list` };
  },
});

// Marks a todo as done
export const complete = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, { id }) => {
    const todo = await ctx.db.get(id);
    if (!todo) return { success: false, message: "Todo not found" };
    await ctx.db.patch(id, { completed: true });
    return { success: true, message: `Completed "${todo.text}"` };
  },
});

// Marks a todo as not done
export const uncomplete = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, { id }) => {
    const todo = await ctx.db.get(id);
    if (!todo) return { success: false, message: "Todo not found" };
    await ctx.db.patch(id, { completed: false });
    return { success: true, message: `Marked "${todo.text}" as not complete` };
  },
});

// Deletes a todo
export const remove = mutation({
  args: { id: v.id("todos") },
  handler: async (ctx, { id }) => {
    const todo = await ctx.db.get(id);
    if (!todo) return { success: false, message: "Todo not found" };
    await ctx.db.delete(id);
    return { success: true, message: `Removed "${todo.text}"` };
  },
});

// Deletes all completed todos
export const clearCompleted = mutation({
  args: {},
  handler: async (ctx) => {
    const completed = await ctx.db
      .query("todos")
      .filter((q) => q.eq(q.field("completed"), true))
      .collect();
    for (const todo of completed) {
      await ctx.db.delete(todo._id);
    }
    return {
      success: true,
      message: `Cleared ${completed.length} completed todos`,
    };
  },
});
