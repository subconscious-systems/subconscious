# Aider + Subconscious

Point [Aider](https://aider.chat) at your hosted Subconscious model via its
OpenAI-compatible endpoint — just env vars and the `--model` flag.

```bash
python -m pip install aider-install && aider-install   # isolated install (or: uv tool install aider-chat)
export OPENAI_API_BASE=https://api.subconscious.dev/v1
export OPENAI_API_KEY=your_key                  # https://subconscious.dev/platform
aider --model openai/subconscious/tim-qwen3.6-27b
```

> Install via `aider-install` (or `uv`), **not** a bare `pip install aider-chat` —
> on newer Python that build fails. Both put `aider` in an isolated environment.

Or use the helper (reads `SUBCONSCIOUS_API_KEY` / `SUBCONSCIOUS_MODEL`):

```bash
./run.sh
```

Swap the model with one variable: `SUBCONSCIOUS_MODEL=… ./run.sh`.
