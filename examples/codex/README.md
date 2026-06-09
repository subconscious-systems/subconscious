# Codex + Subconscious

Run the [Codex CLI](https://developers.openai.com/codex) on your hosted
Subconscious model. This folder ships a `config.toml` that registers Subconscious
as a custom OpenAI-compatible provider; `CODEX_HOME` points Codex at it (so your
global `~/.codex` is untouched).

```bash
npm i -g @openai/codex
export SUBCONSCIOUS_API_KEY=your_key            # https://subconscious.dev/platform
export CODEX_HOME=$(pwd)                          # use this folder's config.toml
codex                                             # interactive
codex exec "summarize README.md"                  # one-shot
```

Helper:

```bash
./run.sh                  # interactive
./run.sh exec "..."       # one-shot
```

Swap the model by editing `model = "..."` in `config.toml`.
