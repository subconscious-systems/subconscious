# CLAUDE.md

This repository is the `subc` CLI, published to npm as `subconscious-cli`.

- `bin/` — the `subc` entry point, profiles, and coding-agent integrations. `subc login` creates the default profile. Persistent integrations use `subc <agent> install` / `subc <agent> uninstall`.
- `agents/registry.json` — the single source of truth for coding-agent metadata and CLI routing. `bin/registry.generated.json` and `bin/runbook/model-capabilities.generated.sh` are generated from it. Executable integrations live under `bin/runbook`. Edit `agents/registry.json`, then run `node scripts/generate-agents.js`. Do not hand-edit the generated outputs.
- `tui/` — the native menu opened when `subc` runs with no arguments.
- Releases are owned by Release Please. Do not hand-edit `package.json` `version` or `CHANGELOG.md`. Commit subjects must be conventional (`feat:`, `fix:`, `perf:`, and the other prefixes in `CONTRIBUTING.md`).

The registry's `modelCapabilities` generates `bin/runbook/model-capabilities.generated.sh`. Do not hand-edit this helper; run `node scripts/generate-agents.js` after changing model capabilities.

## Keep the harness manifest current

`bin/harness-manifest.generated.json` (`subc harness-manifest --json`) is how other tools, bench-runner first, learn how subc installs, configures, and launches each harness. They act on it without reading the runbooks, so a stale entry silently breaks them.

Whenever you change anything under `bin/runbook/<agent>/`, update that agent's `harness` block in `agents/registry.json` in the same pull request, then run `npm run generate`. Check every part the change can touch: install and minimum version, launch argv, inputs and their defaults, exported env, files and config written, and capabilities such as compaction, MCP, headers, and hooks. Mark a value `verified: false` with a `note` when the runbook does not prove it.

If the change cannot affect any of that (a comment, a log message), add this line to a commit message or the PR description:

```
Harness-Manifest: unchanged
```

The `harness-manifest` CI check fails a pull request that changes a runbook without either. Run it locally with `npm run check:harness-manifest`. The drift tests (`npm test`) separately check that the manifest's values still match the runbooks.
