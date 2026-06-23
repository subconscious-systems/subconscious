# subconscious-cli

Log in to Subconscious from your terminal, then launch your favorite coding
agent against your hosted Subconscious model — no per-agent config required.

## Quick start

```bash
npx subconscious-cli login          # sign in, saves your API key
npx subconscious-cli claude-code    # launch Claude Code on Subconscious
```

Installed globally it's just `subconscious <command>`:

```bash
npm install -g subconscious-cli
subconscious login
subconscious open-code
```

## Launching coding agents

`subconscious <agent>` resolves your saved API key, injects the env vars that
point the agent at Subconscious, and exec's the real CLI. Nothing is written to
the agent's own config — the provider is passed in-memory for that run only.

Install commands are **OS-specific** — the CLI picks the right one for your
platform automatically. The table below shows the macOS/Linux command; on
Windows the equivalent native installer is used instead.

| Command                    | Launches    | Requires (install, macOS/Linux)                         |
| -------------------------- | ----------- | ------------------------------------------------------- |
| `subconscious claude-code` | Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash`       |
| `subconscious open-code`   | OpenCode    | `npm i -g opencode-ai`                                  |
| `subconscious aider`       | Aider       | `python3 -m pip install aider-install && aider-install` |
| `subconscious codex`       | Codex CLI   | `npm i -g @openai/codex`                                |

Claude Code uses its **native installer** (the `curl`/`irm` script above), with
`npm i -g @anthropic-ai/claude-code` kept as an automatic fallback if the native
installer fails.

If the underlying agent isn't installed and you're in an interactive terminal,
the CLI offers to install it for you (just press Enter), runs the right
installer for your OS (trying the fallback if the primary fails), and launches
it once the install succeeds. In a non-interactive context (CI) it instead
prints the exact install command (and any fallback) and exits without running
anything.

Freshly-installed binaries (e.g. Aider and Claude Code land in `~/.local/bin`,
npm globals in the npm prefix) often aren't on your current shell's `PATH` yet.
The CLI looks in those common locations and launches the agent anyway. If it
still can't find the binary right after install, it tells you to **open a new
terminal** (or add the printed dir to `PATH`) and re-run the command — the
install itself succeeded.

Anything after the agent name is forwarded straight to it:

```bash
subconscious claude-code --resume
subconscious codex exec "write a test"
```

### Choosing a model

Defaults to `subconscious/tim-qwen3.6-27b`. Override per run with `--model`, or
set `SUBCONSCIOUS_MODEL` in your environment:

```bash
subconscious open-code --model subconscious/tim-qwen3.6-27b
export SUBCONSCIOUS_MODEL=subconscious/tim-qwen3.6-27b
```

### Pointing at a different endpoint

By default the CLI targets `https://api.subconscious.dev`. Override the base URL
per run (or for a whole session) with `SUBCONSCIOUS_BASE_URL` — it flows to both
the Anthropic-style base and the OpenAI-compatible `/v1` base:

```bash
SUBCONSCIOUS_BASE_URL=http://localhost:9999 subconscious claude-code
```

## Auth commands

### `login`

Opens your browser to sign in (or create an account). After authentication, your
API key is automatically generated and saved.

```
Terminal                          Browser
  │                                  │
  │  1. Start local callback server  │
  │  2. Open browser ───────────────►│
  │                                  │  3. Sign in / sign up via Clerk
  │                                  │  4. API key auto-created
  │  5. Receive key ◄────────────────│
  │  6. Save to ~/.subcon/config.json│
  │                                  │  "You can close this tab"
  ✓ Logged in!                       │
```

### `logout`

Removes your saved API key.

### `whoami`

Shows your current authentication status and which key is active.

## Where keys are stored

Keys are saved to `~/.subcon/config.json` with `600` permissions
(owner-read-only). The file looks like:

```json
{
  "subconscious_api_key": "sk-..."
}
```

Environment variable `SUBCONSCIOUS_API_KEY` takes precedence over the config
file — handy for CI or temporary overrides.
