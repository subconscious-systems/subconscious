# Claude Code + Subconscious

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your hosted
Subconscious model — no code changes, just env vars (Subconscious speaks the
Anthropic Messages API). Assumes Claude Code is already installed.

```bash
export ANTHROPIC_BASE_URL=https://api.subconscious.dev
export ANTHROPIC_AUTH_TOKEN=your_key            # https://subconscious.dev/platform
export ANTHROPIC_MODEL=subconscious/tim-qwen3.6-27b
export DISABLE_AUTO_COMPACT=true                # let Subconscious manage context, no client-side compaction
claude
```

Swap models by changing `ANTHROPIC_MODEL`.

`DISABLE_AUTO_COMPACT=true` turns off Claude Code's client-side context-window
auto-compaction so the hosted Subconscious model manages context itself.
