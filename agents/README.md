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

## Per-OS install commands

Each auto-installed terminal agent's `install` is an object keyed by Node's `process.platform` values, with an optional `fallback`:

```json
"install": {
  "darwin": "curl -fsSL https://claude.ai/install.sh | bash",
  "linux":  "curl -fsSL https://claude.ai/install.sh | bash",
  "win32":  "powershell -ExecutionPolicy Bypass -Command \"irm https://claude.ai/install.ps1 | iex\"",
  "fallback": "npm i -g @anthropic-ai/claude-code"
}
```

- The CLI resolves `install[process.platform]` at runtime, falling back to `install.linux` if the exact platform key is missing.
- `fallback` (optional) is tried once if the primary install command fails. Only Claude Code defines one (the native installer with npm as a backup); the other agents omit it.
- For agents whose command is identical across OSes (OpenCode, Codex) all three keys are written out explicitly for clarity.

An env value of shape `{ "$json": { ... } }` means: substitute inside the object, then `JSON.stringify` it to a single string.
