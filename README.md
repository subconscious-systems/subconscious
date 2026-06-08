<div align="center">

<a href="https://www.subconscious.dev/">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h1>Subconscious</h1>

<p><strong>Build AI agents that reason, use tools, and solve complex problems — with a single API call.</strong></p>

[![Documentation](https://img.shields.io/badge/docs-subconscious.dev-blue)](https://docs.subconscious.dev)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev/TIM-8b-preview)
[![OpenAI-compatible](https://img.shields.io/badge/API-OpenAI--compatible-412991)](https://docs.subconscious.dev)
[![SPONSORED BY E2B FOR STARTUPS](https://img.shields.io/badge/SPONSORED%20BY-E2B%20FOR%20STARTUPS-ff8800?style=for-the-badge)](https://e2b.dev/startups)

</div>

---

## What is Subconscious?

Subconscious is a **co-designed model and inference runtime for production agents**.

We are not a framework. LangChain-style harnesses wrap any LLM in tool-call loops, but a harness alone cannot make a small model reason reliably — it only steers what the model already does.

We are not just a model. Foundation-model providers ship raw capabilities, then leave orchestration, context management, and tool-call loops for you to stitch together.

Subconscious is what happens when the model and the runtime are designed for each other. Our **TIM models** are trained for recursive, tool-using reasoning. Our **TIMRUN runtime** orchestrates that reasoning — KV-cache pruning, tool execution, subtask management — inside a single inference. The result is agent engines that let **small language models run highly reliable, cost-effective agents in production**, behind a single API call.

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
| **[CLI Agent](examples/cli_agent/)** | Clone-and-go terminal agent: client-side ReAct loop over MCP tools | TypeScript, Ink, MCP |
| **[E2B CLI Agent](examples/e2b_cli/)** | Autonomous CLI agent with E2B cloud sandboxes for code execution and file I/O | TypeScript, E2B |
| **[Convex Real-time App](examples/convex_app/)** | AI todo assistant with real-time updates backed by Convex | React, Convex, TypeScript |
| **[Composio Agent](examples/composio_fast_api/)** | 100+ OAuth apps as agent tools via Composio, executed in a client-side loop | Python |
| **[Local-Hosted Tools](examples/local_hosted_tools/)** | Client-side tool loop with local Python functions; image-editing demo | Python |
| **[Structured Output (Python)](examples/structured_output_python/)** | Type-safe structured responses via Pydantic + `response_format` | Python, Pydantic |
| **[Structured Output (TypeScript)](examples/structured_output_typescript/)** | Type-safe structured responses via Zod + `response_format` | TypeScript, Zod |
| **[Getting Started Notebook](examples/getting_started_notebook/)** | Colab walkthrough — no setup required | Python, Jupyter |
| **[City of Boston Getting Started](examples/city_of_boston_getting_started/)** | Colab notebook tailored to the City of Boston POC | Python, Jupyter |

### Adding Your Own Example

1. Create a folder under `examples/` with your project code.
2. Add metadata (`package.json` for JS/TS or `pyproject.toml` for Python) with `name`, `description`, and an optional `setup` array of post-scaffold instructions.
3. Open a PR. When it merges, a [GitHub Action](.github/workflows/generate-manifest.yml) regenerates `examples/manifest.json` and your example becomes available via `npx create-subconscious-app` immediately.

## Skills

Skills are reusable knowledge packages that give agents specialized capabilities like coding standards, domain expertise, and workflow guidelines. Manage them in the [dashboard](https://www.subconscious.dev/platform/skills), import from GitHub, or create them with the AI skill builder. See the [Skills docs](https://docs.subconscious.dev/core-concepts/skills) for how to attach them to a run.

## Webhooks

Get a POST when runs complete instead of polling. Two options:

- **Per-run callback**: pass `callbackUrl` on any run request
- **Org-wide subscriptions**: set up persistent endpoints that receive webhooks for all runs

Manage subscriptions in the [dashboard](https://www.subconscious.dev/platform/webhooks) or via the API (`POST /v1/webhooks/subscriptions`). Supports event filtering, enable/disable, HMAC-SHA256 signing, and a delivery log. See the [webhooks docs](https://docs.subconscious.dev/core-concepts/async-webhooks).

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
