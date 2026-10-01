# Agent registry

`registry.json` is the single source of truth for coding-agent metadata, CLI routing, and install commands.

Everything else is generated from it:

- `bin/registry.generated.json`
- `bin/runbook/model-capabilities.generated.sh`

The executable integrations live under `bin/runbook`. Each CLI-enabled registry entry points to its script with a `runbook` block.

## Editing

Edit `registry.json`, then regenerate:

```bash
node scripts/generate-agents.js
```

Do not hand-edit the generated files. Your changes will be overwritten on the next generate.

`command` selects the primary `subc <command>` spelling while `aliases` keeps alternate spellings. `runbook.setupActions` lists which of `install`, `status`, and `uninstall` the CLI exposes on that agent.

## Tokens

Values may contain placeholder tokens that the CLI substitutes at runtime:

| Token | Resolves to |
| --- | --- |
| `{apiKey}` | your resolved API key |
| `{model}` | `--model` / `SUBCONSCIOUS_MODEL` / default |
| `{baseUrl}` | `SUBCONSCIOUS_BASE_URL` / default |
| `{baseUrlV1}` | `${baseUrl}/v1` |

`defaults.models` is the offline fallback catalog for `subc models` and the packaged coding-agent model pickers. At runtime the CLI prefers the selected profile's authenticated `/v1/models/available` response, then the public `/v1/models` fleet catalog. `defaults.model` selects which entry new profiles use initially.

`modelCapabilities` records explicit capabilities by exact gateway model ID. The generator writes `bin/runbook/model-capabilities.generated.sh` for Unix, while Windows reads the generated JSON registry. Each harness translates this into its own vision or image-input fields; unlisted models retain their existing settings.

`{env:...}` is OpenCode's own templating and is preserved verbatim. It is never substituted by us.

## Install commands and URLs

`subc` never installs third-party harnesses. When a harness binary is missing, the CLI prints the vendor's `install` command (display-only, never executed) plus the vendor's official install page from `installUrl`. Only first-party binaries (Subconscious Code / Marathon) may be installed by `subc` itself.

Each terminal agent's `install` is an object keyed by Node's `process.platform` values. These strings are **display-only** and must be actionable npm (or pip) commands — never pipe-to-shell (`curl ... | bash`, `irm ... | iex`), which we do not ship for third-party software:

```json
"install": {
  "darwin": "npm i -g @anthropic-ai/claude-code",
  "linux":  "npm i -g @anthropic-ai/claude-code",
  "win32":  "npm i -g @anthropic-ai/claude-code"
},
"installUrl": "https://docs.anthropic.com/en/docs/claude-code/setup"
```

- The CLI resolves `install[process.platform]` at runtime, falling back to `install.linux` if the exact platform key is missing.
- `installUrl` (required for third-party agents with a binary) links to the vendor's official install/download page and is printed as "Other install options".
- For agents whose command is identical across OSes (OpenCode, Codex) all three keys are written out explicitly for clarity.

An env value of shape `{ "$json": { ... } }` means: substitute inside the object, then `JSON.stringify` it to a single string.
