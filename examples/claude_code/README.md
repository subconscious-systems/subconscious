# Claude Code + Subconscious

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on your hosted
Subconscious model — no code changes, just env vars (Subconscious speaks the
Anthropic Messages API). Assumes Claude Code is already installed.

```bash
export ANTHROPIC_BASE_URL=https://api.subconscious.dev
export ANTHROPIC_AUTH_TOKEN=your_key            # https://subconscious.dev/platform
export ANTHROPIC_MODEL=subconscious/tim-qwen3.6-27b
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000    # see "Auto-compaction" below
claude
```

Swap models by changing `ANTHROPIC_MODEL`.

## Auto-compaction

Claude Code only auto-detects a model's context window for first-party Anthropic
endpoints, so on a custom `ANTHROPIC_BASE_URL` it falls back to a hardcoded
200K default. For Subconscious models that don't match that, auto-compaction
fires at the wrong point — too late (and the request eventually exceeds the real
limit) or never.

Setting `CLAUDE_CODE_AUTO_COMPACT_WINDOW` pins the window Claude Code uses for
its auto-compaction threshold. `150000` gives a safe threshold (~117K, after
Claude Code reserves room for the summary) that triggers compaction well before
`tim-qwen3.6-27b`'s real 262,144-token limit. Tune it to your model: keep it
comfortably below the model's context length so compaction always runs first.
