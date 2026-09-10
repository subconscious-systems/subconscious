# Agent registry — single source of truth

`registry.json` is the **single source of truth** for coding-agent metadata,
CLI routing, install commands, and launch environments.

The CLI runtime data — `cli/bin/registry.generated.json` — is generated from it.
The executable integrations live under `cli/bin/runbook`. Each CLI-enabled
registry entry points to its script with a `runbook` block.

## Editing

Edit `registry.json`, then regenerate:

```bash
npm run generate
```

Do **not** hand-edit the generated CLI data. `command` selects the primary
`subc <command>` spelling while `aliases` keeps alternate spellings.
`runbook.setupActions` lists which of `install`, `status`, and `uninstall` the
CLI exposes on that agent.

## Tokens

Values may contain placeholder tokens that the CLI substitutes at runtime:

| Token         | Resolves to |
| ------------- | ------------ |
| `{apiKey}`    | your resolved API key |
| `{model}`     | `--model` / `SUBCONSCIOUS_MODEL` / default |
| `{baseUrl}`   | `SUBCONSCIOUS_BASE_URL` / default |
| `{baseUrlV1}` | `${baseUrl}/v1` |

`defaults.models` is the offline fallback catalog for `subc models` and the
packaged coding-agent model pickers. At runtime the CLI prefers the selected
profile's authenticated `/v1/models/available` response, then the public
`/v1/models` fleet catalog. `defaults.model` selects which entry new profiles
use initially.

`{env:...}` is **OpenCode's own** templating and is preserved verbatim — it is
never substituted by us.

## Per-OS install commands

Each auto-installed terminal agent's `install` is an **object keyed by Node's
`process.platform`** values, with an optional `fallback`:

```json
"install": {
  "darwin": "curl -fsSL https://claude.ai/install.sh | bash",
  "linux":  "curl -fsSL https://claude.ai/install.sh | bash",
  "win32":  "powershell -ExecutionPolicy Bypass -Command \"irm https://claude.ai/install.ps1 | iex\"",
  "fallback": "npm i -g @anthropic-ai/claude-code"
}
```

- The CLI resolves `install[process.platform]` at runtime, falling back to
  `install.linux` if the exact platform key is missing.
- `fallback` (optional) is tried once if the primary install command fails. Only
  Claude Code defines one (the native installer with npm as a backup); the other
  agents omit it.
- For agents whose command is identical across OSes (OpenCode, Codex) all three
  keys are written out explicitly for clarity.

An env value of shape `{ "$json": { ... } }` means: substitute inside the
object, then `JSON.stringify` it to a single string.
