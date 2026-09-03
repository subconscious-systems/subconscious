# subconscious-cli

Log in to Subconscious, then run coding agents against the Subconscious gateway.

## Quick start

```bash
npm install -g subconscious-cli
subc login
subc claude
```

Every interactive `subc` command checks npm for a newer CLI release. When an
update is available, a notice shows the installed and latest versions and lets
you select **Update now** or **Skip for now** with the arrow keys and Enter.
Each option describes what it will do, and the active option is highlighted.
Update runs `npm install -g subconscious-cli@latest`; Skip continues the
requested command.
Non-interactive commands automatically skip, and registry errors and timeouts
never block the requested command. Set `SUBC_DISABLE_UPDATE_CHECK=1` to suppress
the check in offline automation.

Login creates both the saved credential and a ready-to-use `default` profile,
so Claude Code, Codex, OpenCode, and DeepSeek Harness can launch immediately.
Persistent editor and Pi integrations are installed per agent:

```bash
subc cursor install
subc copilot install
subc pi
subc <agent> uninstall
```

Running `subc` with no arguments in a terminal opens the native Go TUI. Use
the arrow keys and Enter to launch agents or manage the active profile, `p` to
switch profiles, and `q` to quit. The menu includes dedicated **Create profile**,
**Set default model**, **Set subagent model**, and **Update base URL** actions.
Model and URL changes are validated and saved to the active profile without
leaving the TUI.
`subc help` and `subc --help` continue to print script-friendly command help.
Non-interactive `subc` also prints regular help.

Print the installed CLI version without performing an update or gateway check:

```bash
subc --version
subc -v
```

Every command accepts `help` as a subcommand. These only read the selected
profile; they do not authenticate, install, configure, or launch anything:

```bash
subc claude help
subc codex help
subc cursor help
subc config help
subc login help
```

Agent help includes launch/install behavior, supported integration options, and
every relevant profile setting with API keys redacted.

`subc claude` launches the normal `claude` executable with the Subconscious
gateway environment applied for that process. Arguments pass through as usual:

```bash
subc claude --continue
subc codex exec "write a test"
subc opencode
subc pi
subc dsh
```

## Supported agents

The packaged integrations live in `cli/bin/runbook`.

| Command | Behavior |
| --- | --- |
| `subc claude` | Launch Claude Code with the runbook environment, context limits, subagent limits, and OTEL usage reporting |
| `subc codex` | Launch Codex with the runbook provider, temporary model catalog, and surgically merged compaction hooks |
| `subc opencode` | Launch OpenCode with the runbook provider, client header, and context/output limits |
| `subc cursor install` | Install/update Cursor conversation and compaction hooks |
| `subc copilot install` | Install/update the VS Code custom endpoint and Copilot hooks |
| `subc pi` | Refresh the Pi provider from the live catalog, then launch |
| `subc dsh` | Launch the DeepSeek Harness Web UI with a temporary provider populated from the live catalog |

If Claude Code, Codex, OpenCode, or DeepSeek Harness is missing, an interactive terminal offers
to install it before launching. Pi refreshes its Subconscious provider on every
`subc pi` launch while preserving all other providers in `models.json`; its
executable must already be installed.

`subc codex` disables Codex apps and plugin tools for that launch by default so
requests remain below the gateway's 128-tool limit. Core coding tools remain
available. Use `subc codex --external-tools` to opt back in when targeting a
gateway with a larger tool limit. It also defaults reasoning effort to `max`,
which is the highest effort accepted by the Subconscious models; override it
with `subc codex --reasoning-effort high` when desired.

Persistent writes are merge/unmerge only. They never replace a user's
`config.toml`, `opencode.json`, `models.json`, `hooks.json`, or VS Code
provider list. Remove Subconscious files with the matching uninstall command:

```bash
subc cursor uninstall
subc copilot uninstall
subc pi uninstall
subc codex uninstall
subc claude uninstall
subc opencode uninstall
```

`subc claude uninstall` and `subc opencode uninstall` only clean leftover files
from older overwrite-style setup. Launch those agents with `subc claude` /
`subc opencode`; they do not need install.

Inspect a persistent integration with `subc <agent> status`. A one-off
`--api-key` passed to install takes precedence for that command but is not
saved to the selected profile.

Cursor still requires enabling its OpenAI API Key Override in Cursor Settings.
Copilot requires entering the custom endpoint key once through VS Code's
Manage Language Models UI. The install scripts print the relevant next steps.
Its Custom Endpoint provider uses the Messages API at `/v1/messages` by
default; rerun `subc copilot install` to migrate an older Chat Completions entry.

The runbook scripts require Bash. Cursor, Copilot, Pi, and Codex hook merge
also require `jq`; Cursor and Copilot also require `curl`.

`subc dsh` defaults to the DeepSeek Harness Web UI. It injects an ephemeral
Cordis overlay containing the active gateway URL, selected model, token limits,
client header, and every model from the live catalog (`/v1/models/available`
when a profile key is present, otherwise public `/v1/models`); the API key remains in
the process environment and is never written into the overlay. The temporary
file is removed when Harness exits, and existing `$DSH_HOME` settings are not
rewritten. Run a one-shot task with `subc dsh headless "PROMPT"`.

## Runbook profiles

`subc login` automatically creates:

```text
~/.subconscious/profiles/default.env
```

The file is mode `600` and contains the shared gateway URL, API key, model,
optional per-agent key overrides, and all Claude/Codex/OpenCode/Pi/Copilot/
DeepSeek Harness context and output settings used by the packaged runbook scripts.

```bash
subc config                         # list every profile and its file path
subc -p staging config create      # create a profile with default settings
subc -p staging config              # print that path and env file
subc -p staging config --model subconscious/glm-5.2
subc -p staging config --subagent-model subconscious/deepseek-v4-flash-marathon
subc -p staging config --subagent-model follow-default
subc config --gateway-url https://gateway.example
subc config path
subc config edit                    # open the selected profile in $VISUAL, $EDITOR, vim, or nano
subc -p staging config edit vim
subc config edit nano
```

`subc config` lists each profile next to its `.env` path. `subc -p NAME config`
prints that path, then the file (API keys and other secrets redacted). Extra
`KEY=value` lines in the file are passed through to launches and override
Subconscious-injected defaults; resolved login identity (`GATEWAY_URL`,
`API_KEY`, `MODEL`) still comes from login, `--model`, and the matching flags.
In scripts and CI, keep using `subc config --gateway-url`, `--api-key`,
`--model`, and `--subagent-model`.

The subagent setting controls `CLAUDE_CODE_SUBAGENT_MODEL` for Claude Code.
Use `follow-default` to clear the override so subagents automatically follow
the profile's default model.

Each agent section can hold its own API key. An agent-specific key takes
precedence over the shared profile key and can be used on its own, so profiles
do not need an `API_KEY` when every configured agent has an explicit key.

Named profiles work like AWS CLI profiles:

```bash
subc -p staging config \
  --gateway-url https://staging.example \
  --api-key sk-staging-... \
  --model subconscious/glm-5.2

subc -p staging claude
subc -p staging cursor install
```

You can also select one with `SUBC_PROFILE=staging`. Explicit shell variables
such as `SUBCONSCIOUS_API_KEY`, `SUBCONSCIOUS_BASE_URL`,
`SUBCONSCIOUS_MODEL`, and agent-specific tuning variables override profile
values. A command-line `--model` override has the highest model precedence.

## Models and endpoint overrides

List the available models with `subc models`. When the selected profile has an
API key, the command fetches the key-scoped `/v1/models/available` catalog. If
that request fails, it falls back to the public `/v1/models` fleet list, then
to the models packaged with the CLI:

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
subc config --subagent-model subconscious/tim-qwen3.6-27b
export SUBCONSCIOUS_MODEL=subconscious/glm-5.2
```

Every launch and install fetches the same live catalog without caching. Codex,
OpenCode, Pi, Copilot, Cursor, and DeepSeek Harness receive the complete model
list. The selected profile model is listed first only while the gateway still
advertises it.
OpenCode rebuilds its isolated runtime provider on every `subc opencode` launch,
so models left in older OpenCode configuration files do not leak into the list.
If a saved profile default has been removed, launches use the first live model;
an explicit `--model` or `SUBCONSCIOUS_MODEL` override is always preserved.
Claude Code exposes four native Opus/Sonnet/Haiku/Fable picker slots plus one
custom model option. The CLI remaps those aliases to the live catalog, then
replaces the built-in `/model` lineup (`modelPicker.replaceBuiltInOptions`) and
allowlists only those models (`availableModels`) so Anthropic Fable and
ungranted slugs do not appear. Any other model can still be selected with
`subc claude --model MODEL`. Cursor requires adding
the printed model IDs in its OpenAI API Key Override settings. Use the printed
`/v1` Base URL in Cursor Settings; the profile itself stores the gateway origin
so correlation hooks can post to `/v1/agent-hooks`.

The default gateway is `https://api.subconscious.dev`. Profiles containing
the former exact default (`https://api.subconscious.dev`) migrate automatically;
custom gateway URLs are preserved. Override the active gateway with
`SUBCONSCIOUS_BASE_URL`:

```bash
SUBCONSCIOUS_BASE_URL=http://localhost:9999 subc claude
```

Agent-specific runbook tuning variables are also honored, including
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CODEX_CONTEXT_WINDOW`,
`OPENCODE_CONTEXT_LIMIT`, `PI_CONTEXT_WINDOW`, and the corresponding output or
max-context settings. Extra `KEY=value` lines in the profile env file are
passed through the same way and override Subconscious-injected defaults.

## Authentication

`subc login` opens a browser, completes sign-in, and saves the generated API
key to the selected runbook profile with mode `600`. For the default profile it
also maintains `~/.subconscious/config.json`.

```bash
subc login
subc update-key sk-new-key-...
subc update-url https://api.subconscious.dev
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
subc update-url https://api.subconscious.dev
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
