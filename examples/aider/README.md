# Aider + Subconscious

Run [Aider](https://aider.chat) on your hosted Subconscious model via its
OpenAI-compatible endpoint — just env vars and the `--model` flag. Assumes Aider
is already installed.

```bash
export OPENAI_API_BASE=https://api.subconscious.dev/v1
export OPENAI_API_KEY=your_key                  # https://subconscious.dev/platform
aider --model openai/subconscious/tim-qwen3.6-27b
```

Swap models by changing the `--model` value.
