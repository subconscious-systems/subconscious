# Agent registry — single source of truth

`registry.json` is the **single source of truth** for every coding-agent
config (install command, env vars, launch command) used across this repo.

Everything else is **generated** from it:

- The CLI runtime data — `cli/bin/registry.generated.json`
- Each example's `subconscious.agent` + `setup` blocks in
  `examples/<dir>/package.json`
- `examples/manifest.json`

## Editing

Edit `registry.json`, then regenerate:

```bash
pnpm generate          # or: node scripts/generate-agents.js
```

Do **not** hand-edit the generated CLI data or the `subconscious.agent` /
`setup` blocks in the example `package.json` files — your changes will be
overwritten on the next generate.

## Tokens

Values may contain placeholder tokens that consumers substitute:

| Token          | Resolves to (runtime)                       | Resolves to (examples) |
| -------------- | ------------------------------------------- | ---------------------- |
| `{apiKey}`     | your resolved API key                       | `your_key`             |
| `{model}`      | `--model` / `SUBCONSCIOUS_MODEL` / default  | default model          |
| `{baseUrl}`    | `SUBCONSCIOUS_BASE_URL` / default           | real URL               |
| `{baseUrlV1}`  | `${baseUrl}/v1`                             | real URL               |

`{env:...}` is **OpenCode's own** templating and is preserved verbatim — it is
never substituted by us.

## Per-OS install commands

Each agent's `install` is an **object keyed by Node's `process.platform`**
values, with an optional `fallback`:

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

In the generated example `package.json` blocks, `subconscious.agent.install` is
**flattened to a single string** (the `linux` command) for display — the
templates page expects a string. The full per-OS object lives only in
`cli/bin/registry.generated.json`, which the CLI reads.

An env value of shape `{ "$json": { ... } }` means: substitute inside the
object, then `JSON.stringify` it to a single string.
