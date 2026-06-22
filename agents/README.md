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

An env value of shape `{ "$json": { ... } }` means: substitute inside the
object, then `JSON.stringify` it to a single string.
