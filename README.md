# Subconscious: Long-Horizon Reasoning Engine

<div align="center">

<a href="https://www.subconscious.dev/" style="text-decoration: none;">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h3 style="margin: 8px 0;">
  <a href="https://www.subconscious.dev/" style="text-decoration: none; color: inherit;">
    Subconscious Systems
  </a>
</h3>

[![Paper](https://img.shields.io/badge/paper-arXiv-red.svg)](https://arxiv.org/pdf/2507.16784)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev/TIM-8b-preview)
[![Documentation](https://img.shields.io/badge/docs-subconscious.dev-blue)](https://docs.subconscious.dev)

*Enabling efficient multi-hop reasoning and tool use for extended problem-solving*

</div>

## 🚀 Overview

**TIMRUN** (TIM Runtime) is a high-performance inference engine that orchestrates the **TIM (Thread Inference Model)** for unprecedented long-horizon reasoning capabilities. Subconscious manages the entire inference pipeline, using TIM to predict next tokens while performing intelligent structure checks to extract tool calls and identify prunable subtasks. This enables efficient end-to-end multi-hop tool use and makes complex problem-solving tasks more scalable.

### Key Features

- 🔗 **Multi-hop Reasoning**: Chain complex reasoning steps across extended contexts
- 🛠️ **End-to-End Tool Integration**: Seamlessly incorporate external tools and APIs
- 🎯 **Long-horizon Planning**: Handle tasks requiring extended planning and execution
- 🧠 **Generative Orchestration**: Intelligent context engineering learned by the TIM model and handled by TIMRUN with efficient KV cache pruning

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────────────────────────────┐
│   Input Query   │───▶│         Subconscious Engine            │
│                 │    │                                         │
└─────────────────┘    │  ┌─────────────────┐                    │
                       │  │ Structure Check │                    │
                       │  │                 │                    │
                       │  │ • Tool Calls    │                    │
                       │  │ • Prunable      │                    │
                       │  │   Subtasks      │                    │
                       │  └─────────────────┘                    │
                       │           │                             │
                       │           ▼                             │
                       │  ┌─────────────────┐                    │
                       │  │   TIM Model     │                    │
                       │  │                 │                    │
                       │  │  • Sparse Attn  │ ─────────────      │
                       │  │  • Multi-hop    │             │      │
                       │  │  • Token Pred   │             │      │
                       │  └─────────────────┘             │      │
                       │           │                      │      │
                       │           ▼                      ▼      │
┌─────────────────┐    │  ┌─────────────────┐    ┌─────────────┐ │
│   Tool Usage    │◀───┼──│  Tool Execution │    │ KV Cache    │ │
│                 │    │  │                 │    │ Pruning     │ │
│  • External APIs│    │  │ • Call Tools    │    │             │ │
│  • Tool Calls   │    │  │ • Encode        │    │ • Memory    │ │
│  • Data Sources │    │  │   Response      │    │   Mgmt      │ │
└─────────────────┘    │  └─────────────────┘    └─────────────┘ │
                       │           │                      │      │
                       │           ▼                      ▼      │
                       │  ┌─────────────────────────────────────┐│
                       │  │         Continue Decoding           ││
                       │  │      (with updated context)         ││
                       │  └─────────────────────────────────────┘│
                       └─────────────────────────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │   Final Result  │
                               │                 │
                               └─────────────────┘
```

## 🚀 Quick Start

### Python SDK

Install the package:

```bash
pip install subconscious-sdk
```

> **Note**: The package name is `subconscious-python` but you import it as `subconscious`:

Run your first agent:

```python
from subconscious import Subconscious

client = Subconscious(api_key="your-api-key")

run = client.run(
    engine="tim-gpt",
    input={
        "instructions": "Search for the latest AI news and summarize the top 3 stories",
i         "tools": [{"type": "platform", "id": "fast_search"}],
    },
    options={"await_completion": True},
)

print(run.result.answer)
```

### Node.js SDK

Install the package:

```bash
npm install subconscious
# or
pnpm add subconscious
# or
yarn add subconscious
```

Run your first agent:

```typescript
import { Subconscious } from 'subconscious';

const client = new Subconscious({
  apiKey: process.env.SUBCONSCIOUS_API_KEY!,
});

const run = await client.run({
  engine: 'tim-gpt',
  input: {
    instructions: 'Search for the latest AI news and summarize the top 3 stories',
    tools: [{ type: 'platform', id: 'fast_search', options: {} }],
  },
  options: { awaitCompletion: true },
});

console.log(run.result?.answer);
```

## 🎯 Available Engines

| Engine | API Name | Type | Description |
|--------|----------|------|-------------|
| **TIM** | `tim` | Unified | Our flagship unified agent engine for a wide range of tasks |
| **TIM-Edge** | `tim-edge` | Unified | Highly efficient engine tuned for performance with search tools |
| **TIMINI** | `timini` | Compound | Complex reasoning engine for long-context and tool use backed by Gemini-3 Flash |
| **TIM-GPT** | `tim-gpt` | Compound | Complex reasoning engine for long-context and tool use backed by OpenAI GPT-4.1 |
| **TIM-GPT-Heavy** | `tim-gpt-heavy` | Compound | Complex reasoning engine for long-context and tool use backed by OpenAI GPT-5.2 |

## 🛠️ Tools

Subconscious supports three types of tools:

### Platform Tools

Built-in tools hosted by Subconscious. No setup required. Use with e.g. `{"type": "platform", "id": "fast_search"}`.

| Tool Name             | API Name                | Description                                                |
| --------------------- | ----------------------- | ---------------------------------------------------------- |
| Fast Search            | `fast_search`           | Extremely fast search for simple factual lookups           |
| Web Search             | `web_search`            | Comprehensive web search for detailed research            |
| Fresh Search           | `fresh_search`          | Search the web for content from the last 7 days            |
| Page Reader            | `page_reader`           | Extract content from a specific webpage URL                |
| Find Similar           | `find_similar`          | Find similar links to a given URL                           |
| People Search          | `people_search`         | Search for people, profiles, and bios                      |
| Company Search         | `company_search`        | Search for companies, funding info, and business details   |
| News Search            | `news_search`           | Search for news articles and press coverage                |
| Tweet Search           | `tweet_search`          | Search for tweets and Twitter/X discussions                |
| Research Paper Search  | `research_paper_search` | Search for academic research papers and studies            |
| Google Search          | `google_search`         | Search the web using Google                                 |

### Function Tools

Call your own HTTP endpoints:

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
    # Optional: HTTP headers for authentication
    "headers": {
        "Authorization": "Bearer your-token",
    },
    # Optional: Default parameters hidden from model
    "defaults": {
        "apiVersion": "v2",
    },
}
```

### MCP Tools

Connect to [Model Context Protocol](https://modelcontextprotocol.io/) servers:

```python
mcp_tool = {
    "type": "mcp",
    "url": "https://mcp.example.com",
    "allow": ["read", "write"],
}
```

## 📦 Examples

Scaffold a new project from any example using the CLI:

```bash
npx create-subconscious-app
```

This launches an interactive prompt that fetches the latest examples from this repo and downloads the one you pick. You can also skip the prompts:

```bash
npx create-subconscious-app my-agent -e e2b_cli    # fully non-interactive
npx create-subconscious-app --list                  # print available examples
```

Browse all examples in the [`examples/`](examples/) directory.

### Adding a New Example

1. **Create a folder** under `examples/` with your project code (e.g. `examples/my_cool_agent/`).

2. **Add metadata** so the manifest generator can pick it up:

   - **JS/TS projects** — include a `package.json` with `name`, `description`, and an optional `displayName` and `setup` array:

     ```json
     {
       "name": "my-cool-agent",
       "displayName": "My Cool Agent",
       "description": "Short description of what this example does",
       "setup": [
         "npm install",
         "export SUBCONSCIOUS_API_KEY=your_key",
         "npm run dev"
       ]
     }
     ```

   - **Python projects** — include a `pyproject.toml` with `name`, `description`, and an optional `setup` array:

     ```toml
     [project]
     name = "My Cool Agent"
     description = "Short description of what this example does"

     setup = [
         "pip install -r requirements.txt",
         "export SUBCONSCIOUS_API_KEY=your_key",
         "python main.py"
     ]
     ```

   The `setup` array is shown to users as post-scaffold
   next steps. If omitted, the CLI falls back to sensible
   defaults (`npm install` / `pip install -r requirements.txt`).

3. **Open a PR**. When it merges to `main`, a
   [GitHub Action](.github/workflows/generate-manifest.yml)
   runs `scripts/generate-manifest.js` to regenerate
   `examples/manifest.json` automatically. The
   `npx create-subconscious-app` CLI fetches this manifest
   at runtime, so your new example becomes available
   immediately — no package publish needed.

## 📊 Performance

### Optimization Features

- **Selective Working Memory**: 50% reduction in memory usage for long sequences
- **Tool Caching**: 30% faster repeated tool calls
- **Batched Processing**: Multi-threaded tool execution when possible
- **Memory Management**: Efficient handling of large reasoning chains

## 📚 Documentation

- [Getting Started Guide](https://docs.subconscious.dev/quickstart)
- [API Reference](https://docs.subconscious.dev/api-reference/introduction)
- [Tools Documentation](https://docs.subconscious.dev/core-concepts/tools)
- [Engines Guide](https://docs.subconscious.dev/core-concepts/engines)

## 🔬 Research & Papers

If you found our work helpful in your research, please cite:

```bibtex
@article{tim-timrun,
  title={Beyond Context Limits: Subconscious Threads for Long-Horizon Reasoning},
  author={Hongyin Luo, Nathaniel Morgan, Tina Li, Derek Zhao, Ai Vy Ngo, Philip Schroeder, Lijie Yang, Assaf Ben-Kish, Jack O'Brien, James Glass},
  journal={arXiv preprint arXiv:2507.16784},
  year={2024}
}
```

## 📄 License

This TIM-8b-preview model is licensed under the MIT License.

## 📞 Support

- 📧 Email: hongyin OR jack AT subconscious DOT dev
- 🐛 Issues: [GitHub Issues](https://github.com/subconscious-systems/subconscious-node/issues)
- 📖 Documentation: [docs.subconscious.dev](https://docs.subconscious.dev/)
- 🌐 Platform: [subconscious.dev/platform](https://www.subconscious.dev/platform)

---

<div align="center">
<strong>Ready to unlock the power of long-horizon reasoning? Get started with Subconscious today!</strong>
</div>
