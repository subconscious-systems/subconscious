# OpenCode + Subconscious

Run [OpenCode](https://opencode.ai) on your hosted Subconscious model. Subconscious
is registered as a custom **OpenAI-compatible provider**, injected via OpenCode's
`OPENCODE_CONFIG_CONTENT` env var — OpenCode deep-merges it at startup, so nothing
is written to your `~/.config/opencode` and your native sessions stay untouched.
(Same approach the Subconscious desktop app uses.)

```bash
npm i -g opencode-ai
export SUBCONSCIOUS_API_KEY=your_key            # https://subconscious.dev/platform
./run.sh                                         # launches OpenCode on Subconscious
```

Swap the model with one variable: `SUBCONSCIOUS_MODEL=… ./run.sh`.

### The injected config

`run.sh` builds and exports this (key inlined from your env, never written to disk):

```json
{
  "provider": {
    "subconscious": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://api.subconscious.dev/v1", "apiKey": "<your key>" },
      "models": { "subconscious/tim-qwen3.6-27b": { "name": "Subconscious", "tools": true } }
    }
  },
  "model": "subconscious/subconscious/tim-qwen3.6-27b"
}
```

`tools: true` enables OpenCode's agentic features (file edits, shell). The model is
referenced as `<provider>/<model-id>`.
