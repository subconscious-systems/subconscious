# Composio FastAPI Server

A FastAPI server that pairs **Subconscious** as the AI engine with **Composio** for OAuth connections to 1000+ apps (Gmail, GitHub, Slack, Notion, etc.).

Composio manages user-level OAuth and exposes connected apps as **OpenAI-format tool schemas**. Subconscious provides the model via its OpenAI-compatible API, which natively supports standard OpenAI function tools. All tool calling runs **client-side** inside this FastAPI process: the server passes Composio tool schemas directly as `tools=[...]` to the chat-completions API, then executes any `tool_calls` the model returns via the Composio SDK before looping back to the model.

## Setup

```bash
pip install .
```

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `SUBCONSCIOUS_API_KEY` | [subconscious.dev/platform](https://subconscious.dev/platform) |
| `COMPOSIO_API_KEY` | [platform.composio.dev/settings](https://platform.composio.dev/settings) |

## Run

```bash
uvicorn main:app --reload
```

The server starts at `http://localhost:8000`. Visit `/docs` for the interactive Swagger UI.

## Endpoints

### Run an action

```bash
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user_123", "instructions": "Star the composiohq/composio repo on GitHub"}'
```

Optionally restrict which Composio toolkits are available to the agent:

```bash
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user_123", "instructions": "Send an email to hello@example.com", "toolkits": ["gmail"]}'
```

If the user has not yet connected the required app, complete OAuth first using the `/connect` endpoint below.

### List all connections

```bash
curl http://localhost:8000/connections/user_123
```

### Check a specific connection

```bash
curl http://localhost:8000/connections/user_123/gmail
```

### Connect an app

```bash
curl -X POST http://localhost:8000/connect/gmail \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user_123"}'
```

Open the `redirect_url` from the response in your browser to complete OAuth.

## How it works

1. **Composio tool schemas** — On each `/run` request, the server calls `composio.tools.get(user_id, ...)` to fetch OpenAI-formatted tool schemas for the user's connected apps.
2. **Native function tools** — The schemas are passed directly as `tools=[...]` to `client.chat.completions.create(...)`. No system-prompt injection or `response_format` workaround needed — the Subconscious endpoint supports standard OpenAI function tools natively.
3. **Client-side execution** — When the model returns `tool_calls`, the server executes each call via `composio.tools.execute(slug, arguments, user_id=user_id)`, appends a `role: "tool"` result message for each call, and loops back to the model. Multiple tool calls per turn are supported.
4. **Final answer** — When the model responds with no `tool_calls`, `message.content` is the final answer and the loop exits.
5. **Connection management** — The `/connections` and `/connect` endpoints allow your frontend to render a connections UI and kick off OAuth flows.

## File structure

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — endpoints, input validation, startup checks |
| `agent.py` | Client-side ReAct loop using the Subconscious OpenAI-compatible API |
| `composio_adapter.py` | Composio SDK wrapper — schema fetching and tool execution |
