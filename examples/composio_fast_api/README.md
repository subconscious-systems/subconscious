# Composio FastAPI Server

A FastAPI server that pairs **Subconscious** as the AI engine with **Composio** for OAuth connections to 1000+ apps (Gmail, GitHub, Slack, Notion, etc.).

Composio handles user-level OAuth and exposes connected apps as MCP tools. Subconscious runs the agent and calls those tools during execution — giving you the "connect any app" experience with Subconscious as the model provider.

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

If the user hasn't connected the required app yet, Composio surfaces an auth link so they can complete OAuth and retry.

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

1. **Composio session** — `composio.create(user_id=...)` creates a per-user session. `session.mcp.url` and `session.mcp.headers` expose all connected tools over MCP.
2. **Subconscious run** — The MCP endpoint is passed as a tool to `sub_client.run()`. Subconscious discovers available tools from the MCP server and calls them as needed.
3. **Connection management** — Separate endpoints let you list connections, check status, and kick off OAuth flows so your frontend can render a connections UI.
