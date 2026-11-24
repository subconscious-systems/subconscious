# CLAUDE.md

This repository is the `subc` CLI, published to npm as `subconscious-cli`.

- `bin/` — the `subc` entry point, profiles, and coding-agent integrations. `subc login` creates the default profile. Persistent integrations use `subc <agent> install` / `subc <agent> uninstall`.
- `bin/runbook/<id>/agent.json` — the one source of truth for each coding agent: routing, install, help, profile settings, flags, defaults, env, launch and headless argv, resume, config, and capabilities. The launcher executes from it and `subc harness-manifest` serializes it. `bin/runbook/shared.json` holds the agent order, packaged models, and model capabilities. There are no generated copies. `bin/runbook/README.md` explains the file and how to add or change an agent.
- `bin/t3.js`, `bin/t3-settings.js`, `bin/t3-launch.js`, `bin/t3-codex.js`: `subc t3`, which adds a Codex provider to T3 Code. T3 Code is a host for Codex, not an agent, so it has no agent file and no harness-manifest entry.
- `tui/` — the native menu opened when `subc` runs with no arguments.
- Releases are owned by Release Please. Do not hand-edit `package.json` `version` or `CHANGELOG.md`. Commit subjects must be conventional (`feat:`, `fix:`, `perf:`, and the other prefixes in `CONTRIBUTING.md`).
