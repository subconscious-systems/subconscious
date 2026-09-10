# CLAUDE.md

## Repo structure

- `cli/` — the `subconscious-cli` npm package. `subc` handles login/logout/whoami, named `.env` profiles, usage, upgrades, and coding-agent integrations for Marathon, Claude Code, Codex, OpenCode, Cursor, Copilot, Pi, and DeepSeek Harness.
- `agents/registry.json` — the single source of truth for coding-agent metadata and CLI routing.
- `scripts/generate-agents.js` — generates `cli/bin/registry.generated.json` from the registry.
- `publish_package.sh` — guarded release helper for `subconscious-cli`.

## Generated CLI registry

Do not hand-edit `cli/bin/registry.generated.json`.

Edit `agents/registry.json`, then regenerate:

```bash
npm run generate
```

Executable integrations live under `cli/bin/runbook`. CLI-enabled agents use
their registry `runbook` blocks; persistent integrations use
`subc <agent> install` and `subc <agent> uninstall`.
