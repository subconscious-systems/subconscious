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

| Command                    | Launches    | Requires (install)                                     |
| -------------------------- | ----------- | ------------------------------------------------------ |
| `subconscious claude-code` | Claude Code | `npm i -g @anthropic-ai/claude-code`                   |
| `subconscious open-code`   | OpenCode    | `npm i -g opencode-ai`                                 |
| `subconscious aider`       | Aider       | `python -m pip install aider-install && aider-install` |
| `subconscious codex`       | Codex CLI   | `npm i -g @openai/codex`                               |

If the underlying agent isn't installed, the CLI tells you the exact install
command. Anything after the agent name is forwarded straight to it:

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
