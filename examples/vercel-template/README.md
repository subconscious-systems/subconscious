# Subconscious Agent Runner

Deploy a reasoning agent powered by [Subconscious](https://subconscious.dev) to Vercel in one click.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/subconscious-systems/subconscious/tree/main/examples/vercel-template&env=SUBCONSCIOUS_API_KEY&envDescription=Get%20your%20API%20key%20at%20https://subconscious.dev/platform&project-name=subconscious-agent&repository-name=subconscious-agent)

## What you get

- **Agent Runner UI** — submit tasks and watch the agent use tools and produce results in real-time
- **Streaming answers** — the final response streams token-by-token as it arrives
- **Local tools** — Calculator and WebReader run inside the API route, no tunneling or separate infra needed
- **Tool panel** — view available tools and live activity during agent runs
- **One environment variable** — just `SUBCONSCIOUS_API_KEY`

## Deploy in 60 seconds

1. Click **Deploy with Vercel** above
2. Paste your `SUBCONSCIOUS_API_KEY` when prompted ([get one here](https://subconscious.dev/platform))
3. Done — your agent runner is live

## Local development

```bash
git clone https://github.com/subconscious-systems/subconscious
cd subconscious/examples/vercel-template
npm install
cp .env.example .env.local
# Edit .env.local and replace your_key with your actual API key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Adding tools

Tools are defined in `lib/tools.ts` as plain async functions — no external infra needed.

1. Write an async handler function that receives `params` and returns a plain object
2. Add a `ToolDefinition` entry to the `TOOLS` array (name, description, parameters schema)
3. Register the handler in `TOOL_HANDLERS`

## Model

The app uses the `subconscious/tim-qwen3.6-27b` model via the Subconscious OpenAI-compatible
API at `https://api.subconscious.dev/v1`. This is the only model — there is no engine
selection. The API is fully compatible with the `openai` npm SDK and supports native
OpenAI function tools (`tools` / `tool_calls`).

## Project structure

```
app/
├── api/
│   └── agent/
│       ├── route.ts                # Sync agent endpoint (ReAct loop)
│       └── stream/route.ts         # Streaming SSE endpoint (used by UI)
├── layout.tsx
├── page.tsx
└── globals.css

lib/
├── subconscious.ts                 # OpenAI client singleton + constants
├── tools.ts                        # Tool definitions + local handlers
├── types.ts                        # Request/response types + message builder
└── stream-parser.ts                # SSE stream utilities

components/
├── AgentRunner.tsx                 # Task input + execution orchestrator
├── RunResult.tsx                   # Completed run display (collapsible)
├── ToolPanel.tsx                   # Tool registry + live activity
└── StreamingText.tsx               # Streaming text + loading indicator
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUBCONSCIOUS_API_KEY` | **Yes** | API key from [subconscious.dev/platform](https://subconscious.dev/platform) |

## Learn more

- [Subconscious Docs](https://docs.subconscious.dev)
- [Get an API key](https://subconscious.dev/platform)
