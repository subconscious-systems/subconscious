<div align="center">

<a href="https://www.subconscious.dev/">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h1>Subconscious</h1>

<p><strong>Build AI agents that reason, use tools, and solve complex problems — with a single API call.</strong></p>

[![Documentation](https://img.shields.io/badge/docs-subconscious.dev-blue)](https://docs.subconscious.dev)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev/TIM-8b-preview)
[![npm](https://img.shields.io/npm/v/subconscious)](https://www.npmjs.com/package/subconscious)
[![PyPI](https://img.shields.io/pypi/v/subconscious-sdk)](https://pypi.org/project/subconscious-sdk/)
[![SPONSORED BY E2B FOR STARTUPS](https://img.shields.io/badge/SPONSORED%20BY-E2B%20FOR%20STARTUPS-ff8800?style=for-the-badge)](https://e2b.dev/startups)

</div>

---

## What is Subconscious?

Subconscious is a **co-designed model and inference runtime for production agents**.

We are not a framework. LangChain-style harnesses wrap any LLM in tool-call loops, but a harness alone cannot make a small model reason reliably — it only steers what the model already does.

We are not just a model. Foundation-model providers ship raw capabilities, then leave orchestration, context management, and tool-call loops for you to stitch together.

Subconscious is what happens when the model and the runtime are designed for each other. Our **TIM models** are trained for recursive, tool-using reasoning. Our **TIMRUN runtime** orchestrates that reasoning — KV-cache pruning, tool execution, subtask management — inside a single inference. The result is agent engines that let **small language models run highly reliable, cost-effective agents in production**, behind a single API call.

## Quick Start

### Install the SDK

```bash
# Node.js / TypeScript
npm install subconscious

# Python
pip install subconscious-sdk
```

Get your API key at [subconscious.dev/platform](https://www.subconscious.dev/platform).

### Run your first agent

**TypeScript**

```typescript
import { Subconscious } from 'subconscious';

const client = new Subconscious({
  apiKey: process.env.SUBCONSCIOUS_API_KEY!,
});

const run = await client.run({
  engine: 'tim',
  input: {
    instructions: 'Search for the latest AI news and summarize the top 3 stories',
    tools: [{ type: 'platform', id: 'fast_search' }],
  },
  options: { awaitCompletion: true },
});

console.log(run.result?.answer);
```

**Python**

```python
from subconscious import Subconscious

client = Subconscious(api_key="your-api-key")

run = client.run(
    engine="tim",
    input={
        "instructions": "Search for the latest AI news and summarize the top 3 stories",
        "tools": [{"type": "platform", "id": "fast_search"}],
    },
    options={"await_completion": True},
)

print(run.result.answer)
```

## Examples & Templates

The fastest way to start building is with one of our example templates. Scaffold a new project using the CLI:

```bash
npx create-subconscious-app
```

This launches an interactive prompt that fetches the latest examples from this repo and sets up a project for you. You can also skip the prompts:

```bash
npx create-subconscious-app my-agent -e e2b_cli    # scaffold a specific example
npx create-subconscious-app --list                  # list all available examples
```

### Available Examples

| Example | Description | Stack |
|---------|-------------|-------|
| **[Vercel Agent Runner](examples/vercel-template/)** | Full-stack Next.js app with streaming UI, tool management, and one-click Vercel deploy | Next.js, TypeScript |
| **[E2B CLI Agent](examples/e2b_cli/)** | Autonomous CLI agent with E2B cloud sandboxes for code execution and file I/O | TypeScript, E2B |
| **[Convex Real-time App](examples/convex_app/)** | AI todo assistant with real-time updates backed by Convex | React, Convex, TypeScript |
| **[Composio FastAPI](examples/composio_fast_api/)** | 100+ OAuth apps as agent tools via MCP + Composio | Python, FastAPI |
| **[Local-Hosted Tools](examples/local_hosted_tools/)** | Function-tool starter over FastAPI + ngrok; image-editing demo | Python, FastAPI |
| **[Search Agent CLI](examples/search_agent_cli/)** | Streaming CLI agent with web search | Python, Typer |
| **[Structured Output (Python)](examples/structured_output_python/)** | Type-safe structured responses via Pydantic + `answerFormat` | Python, Pydantic |
| **[Structured Output (TypeScript)](examples/structured_output_typescript/)** | Type-safe structured responses via Zod + `answerFormat` | TypeScript, Zod |
| **[Getting Started Notebook](examples/getting_started_notebook/)** | Colab walkthrough — no setup required | Python, Jupyter |
| **[City of Boston Getting Started](examples/city_of_boston_getting_started/)** | Colab notebook tailored to the City of Boston POC | Python, Jupyter |
| **[Val.Town Example](examples/valtown_example_script/)** | Subconscious from a Val.Town automation script | TypeScript, Val.Town |

### Adding Your Own Example

1. Create a folder under `examples/` with your project code.
2. Add metadata (`package.json` for JS/TS or `pyproject.toml` for Python) with `name`, `description`, and an optional `setup` array of post-scaffold instructions.
3. Open a PR. When it merges, a [GitHub Action](.github/workflows/generate-manifest.yml) regenerates `examples/manifest.json` and your example becomes available via `npx create-subconscious-app` immediately.

## Skills

Skills are reusable knowledge packages that give agents specialized capabilities like coding standards, domain expertise, and workflow guidelines. Pass skill names in your run request and the agent loads instructions on demand via progressive disclosure.

```python
run = client.run(
    engine="tim",
    input={
        "instructions": "Review this code for security issues",
        "skills": ["security-review", "coding-standards"],
    },
    options={"await_completion": True},
)
```

Manage skills in the [dashboard](https://www.subconscious.dev/platform/skills), import from GitHub, or create them with the AI skill builder. See the [Skills docs](https://docs.subconscious.dev/core-concepts/skills) for details.

## Webhooks

Get a POST when runs complete instead of polling. Two options:

- **Per-run callback**: pass `callbackUrl` on any run request
- **Org-wide subscriptions**: set up persistent endpoints that receive webhooks for all runs

Manage subscriptions in the [dashboard](https://www.subconscious.dev/platform/webhooks) or via the API (`POST /v1/webhooks/subscriptions`). Supports event filtering, enable/disable, HMAC-SHA256 signing, and a delivery log. See the [webhooks docs](https://docs.subconscious.dev/core-concepts/async-webhooks).

## Engines

| Engine | API Name | Type | Best For |
|--------|----------|------|----------|
| **TIM** | `tim` | Unified | Flagship engine for a wide range of tasks |
| **TIM-Edge** | `tim-edge` | Unified | Speed, efficiency, search-heavy workloads |
| **TIM-Claude** | `tim-claude` | Compound | Complex reasoning backed by Claude Sonnet (supports images) |
| **TIM-Claude-Heavy** | `tim-claude-heavy` | Compound | Maximum capability, backed by Claude Opus (supports images) |
| **TIM-OSS-Local** | `tim-oss-local` | Compound | Tool-calling with TIM-trained OSS models |
| **TIM-1.5** | `tim-1.5` | Compound | Tool-calling with large OSS models |

Start with `tim` for most applications; reach for `tim-claude` when you need deeper reasoning or image input.

## Tools

Subconscious agents can use three types of tools:

### Platform Tools (built-in, no setup required)

| Tool | API Name | Description |
|------|----------|-------------|
| Fast Search | `fast_search` | Fast search for simple factual lookups |
| Web Search | `web_search` | Comprehensive web search for detailed research |
| Fresh Search | `fresh_search` | Search content from the last 7 days |
| Page Reader | `page_reader` | Extract content from a webpage URL |
| Find Similar | `find_similar` | Find pages similar to a given URL |
| People Search | `people_search` | Search for people, profiles, and bios |
| Company Search | `company_search` | Search for companies and business details |
| News Search | `news_search` | Search for news articles and press coverage |
| Tweet Search | `tweet_search` | Search tweets and X discussions |
| Research Paper Search | `research_paper_search` | Search academic papers and studies |
| Google Search | `google_search` | Search the web using Google |

### Function Tools (your own HTTP endpoints)

When the agent decides to use a tool, Subconscious makes an HTTP POST to the URL you provide — no tool-call loop on your side.

```python
tool = {
    "type": "function",
    "name": "get_weather",
    "description": "Get current weather for a location",
    "url": "https://api.example.com/weather",
    "method": "POST",
    "parameters": {
        "type": "object",
        "properties": {
            "location": {"type": "string", "description": "City name"},
        },
        "required": ["location"],
    },
}
```

### MCP Tools (Model Context Protocol)

Connect to any [MCP](https://modelcontextprotocol.io/) server:

```python
mcp_tool = {
    "type": "mcp",
    "url": "https://mcp.example.com/mcp",
    "allowed_tools": ["read_example_tool", "write_example_tool"],
    "auth": {
        "type": "bearer",
        "token": "your-bearer-token",
    },
}
```

```typescript
const mcpTool = {
    type: 'mcp',
    url: 'https://mcp.example.com/mcp',
    allowedTools: ['read_example_tool', 'write_example_tool'],
    auth: {
        type: 'bearer',
        token: 'your-bearer-token',
    },
};
```

> Requires the latest [subconscious](https://www.npmjs.com/package/subconscious) (Node.js) or [subconscious-sdk](https://pypi.org/project/subconscious-sdk/) (Python).

## Documentation & Resources

- [Getting Started Guide](https://docs.subconscious.dev/quickstart)
- [API Reference](https://docs.subconscious.dev/api-reference/introduction)
- [Tools Documentation](https://docs.subconscious.dev/core-concepts/tools)
- [Engines Guide](https://docs.subconscious.dev/core-concepts/engines)
- [Python SDK](https://github.com/subconscious-systems/subconscious-python) · [Node.js SDK](https://github.com/subconscious-systems/subconscious-node)
- [Platform & Playground](https://www.subconscious.dev/platform)

## Support

- Email: {jack,hongyin,dana,wei}@subconscious.dev
- Issues: [GitHub Issues](https://github.com/subconscious-systems/subconscious/issues)
- Docs: [docs.subconscious.dev](https://docs.subconscious.dev/)

## License

The TIM-8b-preview model is licensed under the MIT License.
