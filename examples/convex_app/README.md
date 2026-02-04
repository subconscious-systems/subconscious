# Convex Real-time App

AI todo assistant with real-time updates using Subconscious + Convex.

Chat with the agent to manage your todos. Changes appear instantly in the UI via WebSocket.

## Setup

```bash
npm install
npx convex dev
```

Create `.env.local`:

```
VITE_CONVEX_URL=https://your-project.convex.cloud
```

Set these in Convex Dashboard (Settings > Environment Variables):

| Variable | Value |
|----------|-------|
| `SUBCONSCIOUS_API_KEY` | Your key from [subconscious.ai](https://subconscious.ai) |
| `CONVEX_URL` | Same URL as above: `https://your-project.convex.cloud` |

## Run

```bash
npm run dev
```

Open http://localhost:5173

## Example Commands

| Say This | What Happens |
|----------|--------------|
| "Add buy groceries" | Todo appears in list |
| "Complete buy groceries" | Todo gets checked off |
| "What's on my list?" | Agent describes your todos |
| "Delete buy groceries" | Todo disappears |
| "Clear completed" | All done todos removed |

## How It Works

```
Browser (React)                    Convex Backend
     |                                   |
     |-- POST /chat ------------------>  |
     |                                   |-- calls Subconscious API
     |                                   |
     |                            Subconscious
     |                                   |-- decides to call tool
     |                                   |
     |                                   |<-- POST /tools/addTodo
     |                                   |-- runs mutation
     |                                   |-- database updates
     |<-- WebSocket update --------------|
     |                                   |
     |                                   |-- returns response
     |<-- assistant message -------------|
```

1. User sends message to `/chat` endpoint
2. Convex calls Subconscious API with tool definitions
3. Subconscious calls back to `/tools/*` endpoints as needed
4. Database updates trigger WebSocket to React
5. UI updates before AI response even finishes

## Project Structure

```
src/
  main.tsx              # Entry point, Convex setup
  App.tsx               # Layout with Chat + TodoList
  components/
    Chat.tsx            # Chat interface
    TodoList.tsx        # Real-time todo display

convex/
  schema.ts             # Database tables
  todos.ts              # Todo mutations
  messages.ts           # Chat history
  tools.ts              # HTTP endpoints for Subconscious
  chat.ts               # Calls Subconscious API
  http.ts               # Routes HTTP endpoints
```

## Adding Tools

Add a mutation in `convex/todos.ts`:

```typescript
export const setPriority = mutation({
  args: { id: v.id("todos"), priority: v.string() },
  handler: async (ctx, { id, priority }) => {
    await ctx.db.patch(id, { priority });
    return { success: true };
  },
});
```

Add HTTP endpoint in `convex/tools.ts`:

```typescript
export const setPriority = httpAction(async (ctx, request) => {
  const { id, priority } = (await request.json()).parameters;
  const result = await ctx.runMutation(api.todos.setPriority, { id, priority });
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
```

Register route in `convex/http.ts`:

```typescript
http.route({
  path: "/tools/setPriority",
  method: "POST",
  handler: setPriority,
});
```

Add tool definition in `convex/chat.ts`:

```typescript
{
  type: "function",
  name: "setPriority",
  description: "Set todo priority",
  url: `${CONVEX_URL}/tools/setPriority`,
  method: "POST",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      priority: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["id", "priority"],
  },
}
```

## Links

- [Subconscious Docs](https://docs.subconscious.ai)
- [Convex Docs](https://docs.convex.dev)
- [Convex HTTP Actions](https://docs.convex.dev/functions/http-actions)

## License

MIT
