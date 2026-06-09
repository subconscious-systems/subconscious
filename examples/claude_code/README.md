# Claude Code + Subconscious

Point [Claude Code](https://docs.anthropic.com/en/docs/claude-code) at your hosted
Subconscious model. Subconscious speaks the Anthropic Messages API, so it's just
env vars — no code changes.

```bash
npm i -g @anthropic-ai/claude-code
export ANTHROPIC_BASE_URL=https://api.subconscious.dev
export ANTHROPIC_AUTH_TOKEN=your_key            # https://subconscious.dev/platform
export ANTHROPIC_MODEL=subconscious/tim-qwen3.6-27b
claude
```

Or use the helper (reads `SUBCONSCIOUS_API_KEY` / `SUBCONSCIOUS_MODEL`):

```bash
./run.sh
```

Swap the model with one variable: `SUBCONSCIOUS_MODEL=… ./run.sh`.
