# CLAUDE.md

This repository is the `subc` CLI, published to npm as `subconscious-cli`.

- `bin/` — the `subc` entry point, profiles, and coding-agent integrations. `subc login` creates the default profile. Persistent integrations use `subc <agent> install` / `subc <agent> uninstall`.
- `agents/registry.json` — the single source of truth for coding-agent metadata and CLI routing. `bin/registry.generated.json` and `bin/runbook/model-capabilities.generated.sh` are generated from it. Executable integrations live under `bin/runbook`. Edit `agents/registry.json`, then run `node scripts/generate-agents.js`. Do not hand-edit the generated outputs.
- `tui/` — the native menu opened when `subc` runs with no arguments.
- Releases are owned by Release Please. Do not hand-edit `package.json` `version` or `CHANGELOG.md`. Commit subjects must be conventional (`feat:`, `fix:`, `perf:`, and the other prefixes in `CONTRIBUTING.md`).

The registry's `modelCapabilities` generates `bin/runbook/model-capabilities.generated.sh`. Do not hand-edit this helper; run `node scripts/generate-agents.js` after changing model capabilities.
