# ol-runbook coding-agent integrations

These runtime files are vendored from `ol-runbook/coding-agents` so the npm
package can run without a separate runbook checkout. The snapshot was synced
from `ol-runbook` commit `2236390` (latest `main` on 2026-08-13), with Claude
Code model-picker aliases and complete Codex, OpenCode, Pi, and Copilot model
catalogs added for the CLI's full Subconscious catalog. Namespaced
`subconscious/...` IDs are supported throughout. Codex app/plugin tools are
also disabled by default to honor the gateway's 128-tool request limit.

Included integrations:

- `claude-code/install.sh` and `run.sh`
- `codex/install.sh`, `run.sh`, `hook.sh`, `hooks.json`, and `hooks-lib.sh`
- `opencode/install.sh`, `run.sh`, and `subconscious-compaction.ts`
- `cursor/install.sh`, `hook.sh`, and `hooks.json`
- `copilot/install.sh`, `hook.sh`, and `hooks.json`
- `pi/install.sh`, `run.sh`, and `subconscious-compaction.ts`

When the upstream setup changes, update this snapshot and the corresponding
entries in `agents/registry.json` together.

This snapshot diverges from ol-runbook on Codex/Pi safety: Codex hooks are
merged into `hooks.json` instead of replacing it, and Pi merges
`.providers.subconscious` instead of replacing `models.json`. Sync those
changes upstream in a follow-up.

At runtime `subc` reads `~/.subconscious/profiles/<name>.env` and injects those values
into these scripts, so users do not need to create a runbook checkout or source
an env file manually.
