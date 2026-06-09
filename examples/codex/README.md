# Codex + Subconscious

Run the [Codex CLI](https://developers.openai.com/codex) on your hosted
Subconscious model. Codex routes through a custom provider defined in a config
file, so we write a throwaway one to a temp `CODEX_HOME` — your real `~/.codex`
is untouched. Assumes Codex is already installed.

```bash
export SUBCONSCIOUS_API_KEY=your_key            # https://subconscious.dev/platform
export CODEX_HOME=$(mktemp -d)
printf 'model = "subconscious/tim-qwen3.6-27b"\nmodel_provider = "subconscious"\n[model_providers.subconscious]\nname = "Subconscious"\nbase_url = "https://api.subconscious.dev/v1"\nenv_key = "SUBCONSCIOUS_API_KEY"\n' > "$CODEX_HOME/config.toml"
codex
```

Swap models by changing `model` in the written config.
