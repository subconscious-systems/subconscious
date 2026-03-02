# Subconscious Agent Runner

Deploy a multi-hop reasoning agent powered by [Subconscious](https://subconscious.dev) to Vercel in one click.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/subconscious-systems/subconscious/tree/main/examples/vercel-template&env=SUBCONSCIOUS_API_KEY&envDescription=Get%20your%20API%20key%20at%20https://subconscious.dev/platform&project-name=subconscious-agent&repository-name=subconscious-agent)

## What you get

- **Agent Runner UI** — submit tasks and watch the agent reason, use tools, and produce results in real-time
- **Live execution trace** — see each reasoning step, tool invocation, and conclusion as they stream in
- **Self-hosted tools** — Calculator and WebReader deploy as API routes alongside your agent
- **Tool panel** — view available tools and live activity during agent runs
- **One environment variable** — just `SUBCONSCIOUS_API_KEY`

## Deploy in 60 seconds

1. Click **Deploy with Vercel** above
2. Paste your `SUBCONSCIOUS_API_KEY` when prompted ([get one here](https://subconscious.dev/platform))
3. Done — your agent runner is live

## Local development

```bash
git clone <your-repo-url>
cd subconscious-agent
npm install
cp .env.example .env.local
```

Add your API key to `.env.local`, then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

That's it. `npm run dev` automatically creates a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) so Subconscious can reach your self-hosted tools — no ngrok, no signup, no config. The tunnel URL is printed in your terminal.

If you don't need self-hosted tools (e.g. only using platform tools), you can skip the tunnel:

```bash
npm run dev:no-tunnel
```

## Self-hosted tools

Your tools live as API routes inside this same app — no separate infra.

| Tool | Route | What it does |
|------|-------|--------------|
| Calculator | `POST /api/tools/calculator` | Evaluates math expressions |
| WebReader | `POST /api/tools/web-reader` | Fetches a URL and returns clean text |

**Adding a new tool:**

1. Create `app/api/tools/your-tool/route.ts`
2. Register it in `lib/tools.ts` inside `getSelfHostedTools()`
3. Add it to `lib/tool-registry.ts` so the UI panel shows it
4. Deploy

## Engines

Set `SUBCONSCIOUS_ENGINE` in `.env.local` to switch models:

| Engine | Best for |
|--------|----------|
| `tim-gpt` | Most use cases (default) |
| `tim-edge` | Speed and efficiency |
| `tim-gpt-heavy` | Maximum capability |

Full list at [docs.subconscious.dev/engines](https://docs.subconscious.dev/engines).

## Project structure

```
app/
├── api/
│   ├── agent/
│   │   ├── route.ts                # Sync agent endpoint
│   │   └── stream/route.ts         # Streaming SSE endpoint (used by UI)
│   └── tools/
│       ├── calculator/route.ts     # Self-hosted calculator
│       └── web-reader/route.ts     # Self-hosted web reader
├── layout.tsx
├── page.tsx
└── globals.css

lib/
├── subconscious.ts                 # SDK singleton
├── tools.ts                        # Tool config (platform + self-hosted)
├── types.ts                        # Request/response types
├── stream-parser.ts                # Incremental JSON stream parser
└── tool-registry.ts                # Client-side tool metadata for UI

components/
├── AgentRunner.tsx                 # Task input + execution orchestrator
├── RunResult.tsx                   # Completed run display (collapsible)
├── ReasoningDisplay.tsx            # Live reasoning step timeline
├── ToolPanel.tsx                   # Tool registry + live activity
└── StreamingText.tsx               # Streaming text + loading indicator

scripts/
└── dev-tunnel.mjs                  # Auto-tunnel for local development
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUBCONSCIOUS_API_KEY` | **Yes** | — | API key from [subconscious.dev/platform](https://subconscious.dev/platform) |
| `SUBCONSCIOUS_ENGINE` | No | `tim-gpt` | Which engine to use |

## Learn more

- [Subconscious Docs](https://docs.subconscious.dev)
- [Get an API key](https://subconscious.dev/platform)
- [Node.js SDK](https://github.com/subconscious-systems/subconscious-node)
