<div align="center">

<a href="https://www.subconscious.dev/">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h1>Subconscious</h1>

<p><strong>Inference systems designed for agents.</strong></p>

[![Documentation](https://img.shields.io/badge/docs-subconscious.dev-blue)](https://docs.subconscious.dev)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev)
[![OpenAI-compatible](https://img.shields.io/badge/API-OpenAI--compatible-412991)](https://docs.subconscious.dev)

</div>

---

## What is Subconscious?

Subconscious is an AI lab that makes open language models dramatically more capable with our inference runtime **TIMRUN** and complementary post-trained **TIM** family of models.

Learn more at [subconscious.dev](https://www.subconscious.dev/).

## Quick Start

Subconscious is **OpenAI-compatible**. Point the official OpenAI SDK at our base URL — no proprietary SDK to install.

### Install the SDK

```bash
# Node.js / TypeScript
npm install openai

# Python
pip install openai
```

Get your API key at [subconscious.dev/platform](https://www.subconscious.dev/platform). The base URL is `https://api.subconscious.dev/v1` and the model is `subconscious/tim-qwen3.6-27b`.

### Run your first agent

**TypeScript**

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: process.env.SUBCONSCIOUS_API_KEY,
});

const completion = await client.chat.completions.create({
  model: 'subconscious/tim-qwen3.6-27b',
  messages: [{ role: 'user', content: 'Explain what an API is in 3 sentences.' }],
});

console.log(completion.choices[0].message.content);
```

**Python**

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="your-api-key",
)

completion = client.chat.completions.create(
    model="subconscious/tim-qwen3.6-27b",
    messages=[{"role": "user", "content": "Explain what an API is in 3 sentences."}],
)

print(completion.choices[0].message.content)
```

> **Thinking is on by default** — the model prepends a reasoning preamble to its reply. For clean, fast answers on chat / structured / classification tasks, pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` (Python) or `chat_template_kwargs: { enable_thinking: false }` on the request body (TypeScript). Leave it on for hard multi-step reasoning.

## Model

There is one model: **`subconscious/tim-qwen3.6-27b`** — a fine-tuned Qwen-3.6 trained for recursive, tool-using reasoning, served behind an OpenAI-compatible endpoint. `/v1/models` reports `supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"]`.

## Tools

Subconscious supports **standard OpenAI function tools**. You pass a `tools` array; when the model wants one, the reply comes back with `tool_calls`. You run the function and send the result back as a `role: "tool"` message — Subconscious does not execute tools for you, so the loop is client-side.

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

resp = client.chat.completions.create(
    model="subconscious/tim-qwen3.6-27b",
    messages=[{"role": "user", "content": "What's the weather in Boston?"}],
    tools=tools,
)
# resp.choices[0].message.tool_calls -> run them, append role:"tool" results, loop.
```

Want **MCP** tools? Connect to the MCP server client-side, convert its tools to OpenAI function tools, and dispatch `tool_calls` back to it — see the [`cli_agent`](examples/cli_agent/) and [Boston notebook](examples/city_of_boston_getting_started/) examples.

## What's in this repo

Developer-facing tooling for building on Subconscious:

- **`cli/`** — `subconscious-cli`: log in and launch coding agents against your hosted Subconscious model
- **`examples/`** — runnable example agents and templates
- **`create-subconscious-app/`** — scaffold a new project from any example
- **`scripts/`** — repo tooling (example manifest generation)

## CLI

Log in to Subconscious from your terminal, then launch your favorite coding agent against your hosted Subconscious model — no per-agent config required.

```bash
npx subconscious-cli login          # sign in, saves your API key
npx subconscious-cli claude-code    # launch Claude Code on Subconscious
```

`subconscious <agent>` resolves your saved API key, injects the env vars that point the agent at Subconscious, and exec's the real CLI — nothing is written to the agent's own config.

| Command | Launches |
|---------|----------|
| `subconscious claude-code` | Claude Code |
| `subconscious open-code` | OpenCode |
| `subconscious aider` | Aider |
| `subconscious codex` | Codex CLI |

Other commands: `logout` removes your saved key, `whoami` shows your current auth status. Keys are saved to `~/.subcon/config.json` (owner-read-only); `SUBCONSCIOUS_API_KEY` takes precedence. See [`cli/README.md`](cli/) for details.

## Examples

Runnable example agents and templates, each in its own folder under [`examples/`](examples/).

| Example | Description | Stack |
|---------|-------------|-------|
| **[Vercel Agent Runner](examples/vercel-template/)** | Full-stack Next.js app with streaming UI, tool management, and one-click Vercel deploy | Next.js, TypeScript |
| **[CLI Agent](examples/cli_agent/)** | Clone-and-go terminal agent: client-side ReAct loop over MCP tools | TypeScript, Ink, MCP |
| **[E2B CLI Agent](examples/e2b_cli/)** | Autonomous CLI agent with E2B cloud sandboxes for code execution and file I/O | TypeScript, E2B |
| **[Convex Real-time App](examples/convex_app/)** | AI todo assistant with real-time updates backed by Convex | React, Convex, TypeScript |
| **[Composio Agent](examples/composio_fast_api/)** | 100+ OAuth apps as agent tools via Composio, executed in a client-side loop | Python |
| **[Local-Hosted Tools](examples/local_hosted_tools/)** | Client-side tool loop with local Python functions; image-editing demo | Python |
| **[Structured Output (Python)](examples/structured_output_python/)** | Type-safe structured responses via Pydantic + `response_format` | Python, Pydantic |
| **[Structured Output (TypeScript)](examples/structured_output_typescript/)** | Type-safe structured responses via Zod + `response_format` | TypeScript, Zod |
| **[Getting Started Notebook](examples/getting_started_notebook/)** | Colab walkthrough — no setup required | Python, Jupyter |
| **[City of Boston Getting Started](examples/city_of_boston_getting_started/)** | Colab notebook tailored to the City of Boston POC | Python, Jupyter |

## create-subconscious-app

The fastest way to start from an example is to scaffold it with the CLI:

```bash
npx create-subconscious-app
```

This launches an interactive prompt that fetches the latest examples from this repo and sets one up for you. You can also skip the prompts:

```bash
npx create-subconscious-app my-agent -e e2b_cli    # scaffold a specific example
npx create-subconscious-app --list                  # list all available examples
```

### Adding your own example

1. Create a folder under `examples/` with your project code.
2. Add metadata (`package.json` for JS/TS or `pyproject.toml` for Python) with `name`, `description`, and an optional `setup` array of post-scaffold instructions.
3. Open a PR. When it merges, a [GitHub Action](.github/workflows/generate-manifest.yml) regenerates `examples/manifest.json` and your example becomes available via `npx create-subconscious-app` immediately.

## Scripts

[`scripts/generate-manifest.js`](scripts/generate-manifest.js) reads each example's metadata and regenerates [`examples/manifest.json`](examples/manifest.json) — the manifest that `create-subconscious-app` and the templates page consume.

```bash
node scripts/generate-manifest.js
```

A GitHub Action runs this automatically on push to `main`, and validates the manifest on PRs.

## Documentation & resources

- [Subconscious](https://www.subconscious.dev/)
- [Documentation](https://docs.subconscious.dev)
- [Platform & Playground](https://www.subconscious.dev/platform)
- [Hugging Face](https://huggingface.co/SubconsciousDev)

## Support

- Email: support@subconscious.dev
- Issues: [GitHub Issues](https://github.com/subconscious-systems/subconscious/issues)
- Docs: [docs.subconscious.dev](https://docs.subconscious.dev/)
