<div align="center">

<a href="https://www.subconscious.dev/">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h1>Subconscious</h1>

<p><strong>Build AI agents that reason, use tools, and solve complex problems — with a single API call.</strong></p>

[![Documentation](https://img.shields.io/badge/docs-subconscious.dev-blue)](https://docs.subconscious.dev)
[![Paper](https://img.shields.io/badge/paper-arXiv-red.svg)](https://arxiv.org/pdf/2507.16784)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev/TIM-8b-preview)
[![npm](https://img.shields.io/npm/v/subconscious)](https://www.npmjs.com/package/subconscious)
[![PyPI](https://img.shields.io/pypi/v/subconscious-sdk)](https://pypi.org/project/subconscious-sdk/)
[![SPONSORED BY E2B FOR STARTUPS](https://img.shields.io/badge/SPONSORED%20BY-E2B%20FOR%20STARTUPS-ff8800?style=for-the-badge)](https://e2b.dev/startups)

</div>

---

## What is Subconscious?

Subconscious is an AI agent platform built on research from MIT CSAIL. We provide the infrastructure to run autonomous agents that can reason over long horizons, use external tools, and solve multi-step problems — all orchestrated behind a single API call.

Traditional LLM APIs require you to manage tool-call loops, context windows, and multi-agent frameworks yourself. Subconscious handles all of that. You define a goal and the tools your agent can use. We handle orchestration, context management, and multi-hop reasoning automatically.

### The technology behind it

Our platform is powered by two core innovations:

- **TIM (Thread Inference Model)** — A family of LLMs trained for recursive, decompositional problem solving. Rather than generating text as flat token sequences, TIM models reasoning as trees measured by both length and depth, enabling virtually unlimited working memory within a single inference.
- **TIMRUN** — A high-performance inference runtime that orchestrates TIM with intelligent KV cache pruning, tool execution, and subtask management. TIMRUN sustains high throughput even when manipulating up to 90% of the KV cache in GPU memory.

Together, they overcome the output limits, positional-embedding constraints, and GPU-memory bottlenecks that prevent standard LLMs from handling complex, multi-step tasks.

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
  engine: 'tim-gpt',
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
    engine="tim-gpt",
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
| **[Vercel Agent Runner](examples/vercel-template/)** | Full-stack Next.js app with streaming reasoning UI and tool management | Next.js, TypeScript |
| **[E2B CLI Agent](examples/e2b_cli/)** | Autonomous CLI agent with cloud sandboxes for code execution | TypeScript, E2B |
| **[Convex Real-time App](examples/convex_app/)** | AI todo assistant with real-time updates | React, Convex, TypeScript |
| **[Search Agent CLI](examples/search_agent_cli/)** | Interactive CLI agent with web search capabilities | Python |
| **[Structured Output (Python)](examples/structured_output_python/)** | Type-safe structured responses using Pydantic models | Python, Pydantic |
| **[Structured Output (TypeScript)](examples/structured_output_typescript/)** | Type-safe structured responses using Zod schemas | TypeScript, Zod |
| **[Getting Started Notebook](examples/getting_started_notebook/)** | Interactive Colab notebook — no experience required | Python, Jupyter |

### Adding Your Own Example

1. Create a folder under `examples/` with your project code.
2. Add metadata (`package.json` for JS/TS or `pyproject.toml` for Python) with `name`, `description`, and an optional `setup` array of post-scaffold instructions.
3. Open a PR. When it merges, a [GitHub Action](.github/workflows/generate-manifest.yml) regenerates `examples/manifest.json` and your example becomes available via `npx create-subconscious-app` immediately.

## Engines

| Engine | API Name | Type | Best For |
|--------|----------|------|----------|
| **TIM** | `tim` | Unified | Flagship engine for a wide range of tasks |
| **TIM-Edge** | `tim-edge` | Unified | Speed, efficiency, search-heavy workloads |
| **TIMINI** | `timini` | Compound | Long-context and tool use, strong reasoning (Gemini-3 Flash) |
| **TIM-GPT** | `tim-gpt` | Compound | Most use cases, good balance of cost and performance (GPT-4.1) |
| **TIM-GPT-Heavy** | `tim-gpt-heavy` | Compound | Maximum capability, complex reasoning (GPT-5.2) |

Start with `tim-gpt` for most applications.

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

## Architecture

```
┌─────────────────┐    ┌─────────────────────────────────────────┐
│   Input Query   │───▶│         Subconscious Engine              │
│                 │    │                                           │
└─────────────────┘    │  ┌─────────────────┐                     │
                       │  │ Structure Check  │                     │
                       │  │                  │                     │
                       │  │ • Tool Calls     │                     │
                       │  │ • Prunable       │                     │
                       │  │   Subtasks       │                     │
                       │  └─────────────────┘                     │
                       │           │                               │
                       │           ▼                               │
                       │  ┌─────────────────┐                     │
                       │  │   TIM Model      │                     │
                       │  │                  │                     │
                       │  │  • Sparse Attn   │ ──────────          │
                       │  │  • Multi-hop     │          │          │
                       │  │  • Token Pred    │          │          │
                       │  └─────────────────┘          │          │
                       │           │                    │          │
                       │           ▼                    ▼          │
┌─────────────────┐    │  ┌──────────────┐    ┌─────────────────┐ │
│   Tool Usage    │◀───┼──│ Tool Execute │    │   KV Cache      │ │
│                 │    │  │              │    │   Pruning       │ │
│  • External APIs│    │  │ • Call Tools │    │                 │ │
│  • Tool Calls   │    │  │ • Encode     │    │ • Memory Mgmt   │ │
│  • Data Sources │    │  │   Response   │    │                 │ │
└─────────────────┘    │  └──────────────┘    └─────────────────┘ │
                       │           │                    │          │
                       │           ▼                    ▼          │
                       │  ┌───────────────────────────────────────┐│
                       │  │       Continue Decoding               ││
                       │  │    (with updated context)             ││
                       │  └───────────────────────────────────────┘│
                       └──────────────────────────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │   Final Result   │
                               └─────────────────┘
```

## Research

Our work is described in detail in the paper **"Beyond Context Limits: Subconscious Threads for Long-Horizon Reasoning"** by researchers from MIT CSAIL and Subconscious Systems.

```bibtex
@article{tim-timrun,
  title={Beyond Context Limits: Subconscious Threads for Long-Horizon Reasoning},
  author={Hongyin Luo, Nathaniel Morgan, Tina Li, Derek Zhao, Ai Vy Ngo, Philip Schroeder, Lijie Yang, Assaf Ben-Kish, Jack O'Brien, James Glass},
  journal={arXiv preprint arXiv:2507.16784},
  year={2024}
}
```

## Documentation & Resources

- [Getting Started Guide](https://docs.subconscious.dev/quickstart)
- [API Reference](https://docs.subconscious.dev/api-reference/introduction)
- [Tools Documentation](https://docs.subconscious.dev/core-concepts/tools)
- [Engines Guide](https://docs.subconscious.dev/core-concepts/engines)
- [Python SDK](https://github.com/subconscious-systems/subconscious-python) · [Node.js SDK](https://github.com/subconscious-systems/subconscious-node)
- [Platform & Playground](https://www.subconscious.dev/platform)

## Support

- Email: hongyin OR jack AT subconscious DOT dev
- Issues: [GitHub Issues](https://github.com/subconscious-systems/subconscious/issues)
- Docs: [docs.subconscious.dev](https://docs.subconscious.dev/)

## License

The TIM-8b-preview model is licensed under the MIT License.
