# subconscious-cli

Log in to Subconscious, then run coding agents with the setup maintained in
[`ol-runbook`](https://github.com/subconscious-systems/ol-runbook).

## Quick start

```bash
npm install -g subconscious-cli
subc login
subc claude
```

Login creates both the saved credential and a ready-to-use `default` runbook
profile, so Claude Code, Codex, and OpenCode can launch immediately. To apply
the persistent runbook setup for all six supported agents together, run:

```bash
subc setup
```

Top-level help (`subc`, `subc help`, or `subc --help`) displays the
Subconscious logo as portable ASCII art. Set `NO_COLOR=1` for a
monochrome version; redirected output automatically uses a plain wordmark.

Each coding agent also has integration-specific help. These commands only read
the selected profile; they do not authenticate, install, configure, or launch
anything:

```bash
subc help claude
subc codex help
subc opencode --help
subc help cursor
subc help copilot
subc pi -h
```

Agent help includes launch/setup behavior, supported integration options, and
every relevant profile setting with API keys redacted.

This writes the Claude environment file; Codex provider, catalog, and hooks;
OpenCode provider and compaction plugin; Cursor and Copilot hooks; and Pi
provider and compaction extension. It configures integrations but does not
install the underlying desktop applications or agent binaries.

`subc claude` launches the normal `claude` executable with the Subconscious
gateway environment applied for that process. Arguments pass through as usual:

```bash
subc claude --continue
subc codex exec "write a test"
subc opencode
subc pi
```

## Supported agents

The packaged integrations are synced from `ol-runbook/coding-agents`.

| Command | Behavior |
| --- | --- |
| `subc claude` | Launch Claude Code with the runbook environment, context limits, subagent limits, and OTEL usage reporting |
| `subc codex` | Launch Codex with the runbook provider, temporary model catalog, and compaction hooks |
| `subc opencode` | Launch OpenCode with the runbook provider, client header, and context/output limits |
| `subc cursor` | Install/update the runbook Cursor conversation and compaction hooks |
| `subc copilot` | Install/update the runbook VS Code custom endpoint and Copilot hooks |
| `subc pi` | Launch Pi with the Subconscious provider and active profile model; never installs or rewrites configuration |

If Claude Code, Codex, or OpenCode is missing, an interactive terminal offers
to install it before launching. Pi is launch-only: if its executable or
Subconscious configuration is missing, the CLI exits with instructions instead
of installing or changing anything.

`subc codex` disables Codex apps and plugin tools for that launch by default so
requests remain below the gateway's 128-tool limit. Core coding tools remain
available. Use `subc codex --external-tools` to opt back in when targeting a
gateway with a larger tool limit. It also defaults reasoning effort to `max`,
which is the highest effort accepted by the Subconscious models; override it
with `subc codex --reasoning-effort high` when desired.

Cursor and Copilot are setup commands because their runbook integrations write
user-level configuration. Pi's provider and extension are managed only through
the aggregate setup command:

```bash
subc cursor status
subc cursor uninstall
subc copilot status
```

You can inspect or remove every persistent integration together too:

```bash
subc setup
subc setup status
subc setup uninstall
```

Target one integration by adding its command name. Agent-specific install
options pass through to that integration:

```bash
subc setup codex
subc setup codex status
subc setup opencode uninstall
subc setup codex --subagents
subc setup claude --compact-window 900000
```

Claude Code and Codex also expose the runbook's persistent environment helpers:

```bash
subc setup codex use -- --resume
source <(subc setup codex env)
source <(subc setup codex unset)
```

Run `subc setup AGENT --help` for that integration's complete persistent setup
options. A one-off `--api-key` passed to targeted setup takes precedence for
that command but is not saved to the selected profile.

Cursor still requires enabling its OpenAI API Key Override in Cursor Settings.
Copilot requires entering the custom endpoint key once through VS Code's
Manage Language Models UI. The setup scripts print the relevant next steps.

The runbook scripts require Bash. Cursor and Copilot setup also require `jq`
and `curl`; Pi setup requires `jq`.

## Runbook profiles

`subc login` automatically creates:

```text
~/.subconscious/profiles/default.env
```

The file is mode `600` and contains the shared gateway URL, API key, model,
optional per-agent key overrides, and all Claude/Codex/OpenCode/Pi/Copilot
context and output settings used by the packaged runbook scripts. You can
inspect or update it through the CLI:

```bash
subc config
subc config --model subconscious/glm-5.2
subc config --gateway-url https://gateway.example
subc config path
subc config list
```

Use the interactive settings wizard to choose or create a profile and edit
shared settings, one agent's complete settings section, or every setting:

```bash
subc settings
subc --profile work settings
subc --profile staging config interactive
```

The wizard validates URLs, numeric ranges, and enumerated values; masks API-key
input; and does not write anything until you choose **Save and exit**. Press
Ctrl-C or choose **Cancel** to discard pending changes. In scripts and CI, keep
using `subc config --gateway-url`, `--api-key`, and `--model` or edit the
mode-`600` profile directly.

Each agent section can hold its own API key. An agent-specific key takes
precedence over the shared profile key and can be used on its own, so profiles
do not need an `API_KEY` when every configured agent has an explicit key.

Named profiles work like mbta profiles:

```bash
subc --profile staging config \
  --gateway-url https://staging.example \
  --api-key sk-staging-... \
  --model subconscious/glm-5.2

subc --profile staging claude
subc --profile staging setup
```

You can also select one with `SUBC_PROFILE=staging` (`MBTA_PROFILE` is accepted
as a compatibility fallback). Explicit shell variables
such as `SUBCONSCIOUS_API_KEY`, `SUBCONSCIOUS_BASE_URL`,
`SUBCONSCIOUS_MODEL`, and agent-specific tuning variables override profile
values. A command-line `--model` override has the highest model precedence.

## Models and endpoint overrides

List the available models with `subc models`:

```text
subconscious/glm-5.2 (default)
subconscious/tim-qwen3.6-27b
subconscious/deepseek-v4-flash-marathon
```

Select a model per run, save it in the current profile, or override it through
the environment:

```bash
subc codex --model subconscious/glm-5.2
subc config --model subconscious/deepseek-v4-flash-marathon
export SUBCONSCIOUS_MODEL=subconscious/glm-5.2
```

The Claude Code, Codex, OpenCode, Pi, and Copilot integrations register all
three models with their native model pickers. The profile's `MODEL` remains the
active model where the agent supports setting one and is listed first in the
other catalogs. Cursor requires adding the three model IDs in its OpenAI API
Key Override settings; `subc cursor` prints the complete list and the model
selected by the active profile.

The default gateway is `https://api-dev.subconscious.dev`. Profiles containing
the former exact default (`https://api.subconscious.dev`) migrate automatically;
custom gateway URLs are preserved. Override the active gateway with
`SUBCONSCIOUS_BASE_URL`:

```bash
SUBCONSCIOUS_BASE_URL=http://localhost:9999 subc claude
```

Agent-specific runbook tuning variables are also honored, including
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CODEX_CONTEXT_WINDOW`,
`OPENCODE_CONTEXT_LIMIT`, `PI_CONTEXT_WINDOW`, and the corresponding output or
max-context settings.

## Authentication

`subc login` opens a browser, completes sign-in, and saves the generated API
key to the selected runbook profile with mode `600`. For the default profile it
also maintains `~/.subconscious/config.json`.

```bash
subc login
subc update-key sk-new-key-...
subc update-url https://api-dev.subconscious.dev
subc whoami
subc logout
```

`subc update-key <api-key>` replaces the shared key in the selected profile.
For `default`, it also synchronizes `~/.subconscious/config.json`:

```bash
subc update-key sk-new-default-key-...
subc --profile staging update-key sk-new-staging-key-...
```

Because command arguments may be retained in shell history, `subc login` is
preferred when obtaining a new key interactively. If `SUBCONSCIOUS_API_KEY` is
set, it continues to override the updated saved key.

`subc update-url <gateway-url>` validates the URL and automatically updates
`GATEWAY_URL` in the default profile. No `--profile` option or separate config
command is needed:

```bash
subc update-url https://api-dev.subconscious.dev
```

If `SUBC_PROFILE` already selects a named profile, that active profile is
updated automatically as well.

`SUBCONSCIOUS_BASE_URL` continues to take precedence when set. A configured
`CLAUDE_GATEWAY_URL` remains a Claude-specific override.

`SUBCONSCIOUS_API_KEY` takes precedence over profile and saved config keys,
which is useful for CI and temporary sessions. `subc logout` clears the
selected profile's shared key while preserving its non-secret runbook settings;
logging out of `default` also clears the backwards-compatible saved key.

Existing credentials and profiles under `~/.subcon` are copied into
`~/.subconscious` automatically on first use. The legacy files are left in
place so migration is recoverable.
