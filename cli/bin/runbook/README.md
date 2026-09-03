# Coding-agent integrations

These scripts are part of `subc`. They launch or surgically install Claude Code,
Subconscious Code, Codex, OpenCode, DeepSeek Harness, Cursor, Copilot, and Pi against the
Subconscious gateway.

`subc` reads `~/.subconscious/profiles/<name>.env` and injects those values into
the scripts, so users do not need a sibling `.env` file. When a script is run
directly, `SUBC_ENV_FILE` (or `cli/bin/runbook/.env`) can supply the same keys.

Included integrations:

- `subconscious-code/install.sh` and `run.sh`
- `claude-code/install.sh` and `run.sh`
- `codex/install.sh`, `run.sh`, `hook.sh`, `hooks.json`, and `hooks-lib.sh`
- `opencode/install.sh`, `run.sh`, and `subconscious-compaction.ts`
- `cursor/install.sh`, `hook.sh`, and `hooks.json`
- `copilot/install.sh`, `hook.sh`, and `hooks.json`
- `pi/install.sh`, `run.sh`, and `subconscious-compaction.ts`
- `deepseek-harness/run.sh`

Each CLI-enabled entry in `agents/registry.json` points here with a `runbook`
block. Persistent writes are merge/unmerge only: they never replace a user's
`config.toml`, `opencode.json`, `models.json`, `hooks.json`, or VS Code
provider list.
