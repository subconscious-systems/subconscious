# CLAUDE.md

## Repo structure

- `examples/` — SDK example projects, each with its own package.json or pyproject.toml
- `examples/manifest.json` — auto-generated manifest consumed by the templates page at subconscious.dev/templates
- `scripts/generate-manifest.js` — reads example metadata → outputs manifest.json
- `create-subconscious-app/` — `npx create-subconscious-app` CLI scaffolder
- `cli/` — `npx subconscious-cli` for login/logout/whoami

## Adding examples

Use `/add-example` command. It walks through scaffolding a new example with all required manifest metadata.

Key rules for setup commands in examples:
- Every step must be a runnable command or `#` comment — no prose
- Use `your_key` as the SUBCONSCIOUS_API_KEY placeholder (auto-replaced by the templates page)
- Use different placeholders for third-party keys (e.g. `your_e2b_key`)
- Commands get chained with `&&` for one-click copy-paste

## Manifest

Regenerate after any example change:
```bash
node scripts/generate-manifest.js
```

GitHub Action auto-regenerates on push to main. On PRs it validates without committing.
