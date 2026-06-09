# Codex + Subconscious

Run the [Codex CLI](https://developers.openai.com/codex) on your hosted
Subconscious model. Subconscious is passed as a custom OpenAI-compatible provider
via inline `-c` config overrides — nothing is written to your `~/.codex` config.
Assumes Codex is already installed.

```bash
export SUBCONSCIOUS_API_KEY=your_key            # https://subconscious.dev/platform
codex \
  -c model_providers.subconscious.name=Subconscious \
  -c model_providers.subconscious.base_url=https://api.subconscious.dev/v1 \
  -c model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY \
  -c model_provider=subconscious \
  -c model=subconscious/tim-qwen3.6-27b
```

> Use `-c model=…` to pick the model — **not** `--model`, which is codex's
> shortcut for the local Ollama provider.

Swap models by changing the `-c model=…` value.
