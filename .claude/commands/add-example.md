---
description: Auto-generate manifest metadata for an existing example project
argument: Name or description of the example project (e.g. "the convex app" or "e2b_cli" or "the python search one")
---

# Finalize Example

The user has already built an example project in `examples/`. Your job is to read the code and generate the manifest metadata fields that the CI action requires.

## Step 0: Inventory check

Before doing anything, get the lay of the land:

1. List all directories in `examples/` (these are the actual example projects on disk)
2. Read `examples/manifest.json` and list all entries by `name`
3. Compare the two lists:
   - **In directory but NOT in manifest** → new example, needs full metadata
   - **In directory AND in manifest but missing v2 fields** (no `language`, `tags`, etc.) → needs metadata update
   - **In manifest but NOT in directory** → stale entry, flag it

Print a short summary like:
```
Found 8 example directories, 7 in manifest.
  ✓ convex_app — in manifest, has v2 fields
  ✓ e2b_cli — in manifest, has v2 fields
  ✗ my_new_example — NOT in manifest (new)
```

## Step 1: Find the project

The argument `$ARGUMENTS` is a natural-language reference to a project in `examples/`. Match it against the directory list from Step 0:

1. Match by exact name, partial name, or description (e.g. "the convex one" → `convex_app`, "python search" → `search_agent_cli`, "the new one" → the one not in the manifest)
2. If the user says something like "the new one" or "the one I just made", match it to whichever directory is NOT yet in the manifest
3. If ambiguous, show the inventory from Step 0 and ask the user to pick

## Step 2: Read the project

Read everything in the matched directory:
- `package.json` or `pyproject.toml` (config file)
- All source files (`.ts`, `.tsx`, `.py`, `.js`, etc.)
- `.env.example` or `.env` files if they exist
- `README.md` if it exists

From this, determine:

| Field | How to detect |
|-------|---------------|
| `language` | `package.json` → `"typescript"`, `pyproject.toml` → `"python"` |
| `framework` | Look at dependencies: `next` → "Next.js", `convex` → "Convex", `@e2b/sdk` → "E2B", `fastapi` → "FastAPI", `flask` → "Flask". Omit if no clear framework. |
| `tags` | Always include the language. Then: has a dev server/UI → add `"web"`. Has a notebook → add `"notebook"`. Otherwise → add `"cli"`. |
| `displayName` | If already set, keep it. Otherwise generate a concise human name from the project purpose. |
| `description` | If already set and non-empty, keep it. Otherwise write ONE sentence describing what it does, mentioning Subconscious. |
| `envVars` | `SUBCONSCIOUS_API_KEY` is always required. Scan code for other env vars (e.g. `E2B_API_KEY`, `OPENAI_API_KEY`). For third-party keys, include `"url"` pointing to where to get them. |
| `setup` | Build from what you see (details in Step 3). |

## Step 3: Generate setup commands

Build the `setup` array — a sequence of commands that, when chained with `&&` after `npx create-subconscious-app my-app --example <name> && cd my-app`, get the project fully running.

### Rules

1. **Every step must be a runnable terminal command or a `#` comment.** No prose.
2. First step is always the install command (`npm install`, `pip install .`, `bun install`)
3. For `SUBCONSCIOUS_API_KEY`:
   - If the project reads from env vars (uses `process.env` or `os.environ`): use `export SUBCONSCIOUS_API_KEY=your_key`
   - If the project reads from `.env` file (uses `dotenv`): use `echo "SUBCONSCIOUS_API_KEY=your_key" > .env`
   - If the project reads from `.env.local` (Next.js): use `echo "SUBCONSCIOUS_API_KEY=your_key" >> .env.local`
   - Check if there's a `.env.example` that needs copying first: `cp .env.example .env.local`
4. Use `your_key` as the placeholder for SUBCONSCIOUS_API_KEY (the templates page auto-replaces this with the user's real key)
5. Use DIFFERENT placeholders for third-party keys (e.g. `your_e2b_key`, `your_openai_key`) — these must NOT match `your_key` exactly
6. Last step is the run command — look at `scripts` in package.json or the main entry file
7. If the run command needs arguments (like a CLI that takes a question), include a sensible example argument
8. If the project has a `.env.example`, include `cp .env.example .env.local` before writing env vars

### Test: would this work?

Mentally run this full chain and verify it wouldn't error:
```
npx create-subconscious-app my-app --example <name> && cd my-app && <step1> && <step2> && ...
```

## Step 4: Write the metadata

**TypeScript projects** — add/update fields in `package.json`:
- Set `displayName` and `description` at the top level
- Add `subconscious` object with `language`, `framework` (if applicable), `tags`, `envVars`
- Update `setup` array

**Python projects** — add/update `[tool.subconscious]` in `pyproject.toml`:
- Set `display_name`, `language`, `tags`
- Update `setup` array
- Update `description` in `[project]` section if empty
- Use single quotes for setup strings that contain double quotes

## Step 5: Regenerate and validate

Run:
```bash
node scripts/generate-manifest.js
```

Then verify the example appears in `examples/manifest.json` with all fields:
- `name` ✓
- `displayName` ✓ (not just the directory name)
- `description` ✓ (non-empty, one sentence)
- `language` ✓ (typescript or python)
- `tags` ✓ (non-empty array)
- `setup` ✓ (all runnable commands, no prose)

Show the user the generated manifest entry for confirmation.
