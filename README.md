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

Get your API key at [subconscious.dev/platform](https://www.subconscious.dev/platform). The base URL is `https://api.subconscious.dev/v1` and the default model is `subconscious/glm-5.3-marathon`.

### Run your first agent

**TypeScript**

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: process.env.SUBCONSCIOUS_API_KEY,
});

const completion = await client.chat.completions.create({
  model: 'subconscious/glm-5.3-marathon',
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
    model="subconscious/glm-5.3-marathon",
    messages=[{"role": "user", "content": "Explain what an API is in 3 sentences."}],
)

print(completion.choices[0].message.content)
```

> **Thinking is on by default** — the model prepends a reasoning preamble to its reply. For clean, fast answers on chat / structured / classification tasks, pass `extra_body={"chat_template_kwargs": {"enable_thinking": False}}` (Python) or `chat_template_kwargs: { enable_thinking: false }` on the request body (TypeScript). Leave it on for hard multi-step reasoning.

## Model

Available models include:

- **`subconscious/glm-5.3-marathon`** (default)
- **`subconscious/glm-5.2`**
- **`subconscious/tim-qwen3.6-27b`**
- **`subconscious/deepseek-v4-flash-marathon`**

They are served behind the OpenAI-compatible endpoint. `/v1/models` reports
the public fleet catalog. `/v1/models/available` reports the models the
authenticated API key may call. The `subc` CLI fetches the provisioned list
when a profile key is present, falls back to the public catalog, and uses
packaged defaults only when discovery is offline.

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
    model="subconscious/glm-5.3-marathon",
    messages=[{"role": "user", "content": "What's the weather in Boston?"}],
    tools=tools,
)
# resp.choices[0].message.tool_calls -> run them, append role:"tool" results, loop.
```

Want **MCP** tools? Connect to the MCP server client-side, convert its tools to OpenAI function tools, and dispatch `tool_calls` back to it.

## What's in this repo

Developer-facing tooling for building on Subconscious:

- **`cli/`** — `subconscious-cli`: use `subc` to authenticate and run the packaged coding-agent integrations
- **`agents/registry.json`** — the source of truth for coding-agent metadata
- **`scripts/`** — tooling that generates the CLI registry data
- **`publish_package.sh`** — guarded release helper for the npm package

## CLI

Log in to Subconscious from your terminal, then launch or configure coding agents.

```bash
npm install -g subconscious-cli
subc login                           # sign in, saves your API key
subc marathon                        # launch Marathon
subc claude                          # launch Claude Code on Subconscious
subc dsh                             # launch DeepSeek Harness on Subconscious
subc cursor install                  # merge Cursor hooks
```

`subc <agent>` resolves your saved API key and runs the packaged integration.
Terminal agents launch directly; Cursor, Copilot, and
Pi persist a surgical integration with `subc <agent> install`. Login also
creates a secure default profile.

| Command | Behavior |
|---------|----------|
| `subc marathon` | Launch the native Marathon agent (or `subc marathon install`) |
| `subc claude` | Launch Claude Code |
| `subc codex` | Launch Codex CLI (merges compaction hooks) |
| `subc opencode` | Launch OpenCode |
| `subc dsh` | Launch DeepSeek Harness with the live Subconscious model catalog |
| `subc cursor install` | Configure Cursor hooks |
| `subc copilot install` | Configure VS Code Copilot endpoint + hooks |
| `subc pi install` then `subc pi` | Configure, then launch Pi |

Use `subc <agent> help` or `subc config help` for command-specific usage.
`subc config` lists profiles and their `.env` paths; `subc -p NAME config`
prints the file, and `subc config edit vim` (or `nano`) opens it. Extra keys in
that file override Subconscious-injected launch defaults. Agent-specific
credentials override the shared profile key and also work when no shared key is
configured.

```bash
subc cursor uninstall
subc pi uninstall
subc -p staging claude
```

Other commands: `update-key <key>` replaces your saved key, `update-url <url>`
automatically changes the active profile's gateway, `logout` removes the key,
and `whoami` shows your current auth status. Keys are saved to
`~/.subconscious/config.json` (owner-read-only); `SUBCONSCIOUS_API_KEY` takes
precedence. See [`cli/README.md`](cli/) for details.

## Development

After changing `agents/registry.json`, regenerate the packaged CLI metadata:

```bash
npm run generate
```

Run the CLI and TUI test suites from the repository root:

```bash
npm test
npm run test:tui --prefix cli
```

## Documentation & resources

- [Subconscious](https://www.subconscious.dev/)
- [Documentation](https://docs.subconscious.dev)
- [Platform & Playground](https://www.subconscious.dev/platform)
- [Hugging Face](https://huggingface.co/SubconsciousDev)

## Support

- Email: support@subconscious.dev
- Issues: [GitHub Issues](https://github.com/subconscious-systems/subconscious/issues)
- Docs: [docs.subconscious.dev](https://docs.subconscious.dev/)
