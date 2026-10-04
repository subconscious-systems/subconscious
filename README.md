# subconscious-cli

Log in to Subconscious, then run coding agents against the Subconscious gateway.

## Quick start

```bash
npm install -g subconscious-cli
subc login
subc marathon
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
so Subconscious Code, Claude Code, Codex, OpenCode, and DeepSeek Harness can launch immediately.
Persistent editor and Pi integrations are installed per agent:

```bash
subc cursor install
subc copilot install
subc pi
subc <agent> uninstall
```

Running `subc` with no arguments in a terminal opens the native Go TUI immediately. The npm update check runs in the background. If a newer release is found, `subc` leaves the menu and shows the same update prompt as any other command. Skip for now returns to the menu. Use
the arrow keys and Enter to launch agents or manage the active profile, `p` to
switch profiles, and `q` to quit. The menu includes dedicated **Usage**,
**Create profile**, **Coding sessions**, **Set default model**, **Set subagent model**,
**Update base URL**, and **Update platform URL** actions.
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
subc marathon help
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
subc marathon -- -p "fix the tests"
subc codex exec "write a test"
subc opencode
subc pi
subc dsh
```

## Native Windows support

Windows has its own implementation in `bin/windows/`, selected only when
Node runs on Windows. macOS/Linux continue to use the existing, unchanged shell
runbooks. WSL continues to use the Linux implementation.

Use Node.js 20, 22, or 24 and Windows PowerShell 5.1+ (included with Windows), from either
PowerShell or Command Prompt. The Windows CLI integrations do not require Bash,
`jq`, `curl`, or WSL. The agents themselves must support your Windows version;
their own dependencies still apply.

```powershell
npm.cmd install -g subconscious-cli@latest
subc.cmd login
subc.cmd claude
subc codex
subc opencode
subc dsh
subc cursor install
subc copilot install
subc pi
subc config edit notepad
```

Native Windows support is included in the stable CLI starting with 4.1.0.
Update with `npm.cmd install -g subconscious-cli@latest` or `subc.cmd upgrade --latest`.

If PowerShell's execution policy blocks npm-generated `.ps1` entry points, use
`npm.cmd` and `subc.cmd` or run the same commands in Command Prompt. No policy
change is required. Pi must already be installed; other terminal agents offer
their Windows installer when missing in an interactive terminal.

Native executables and standard npm `.cmd` shims are supported. The launcher
invokes the underlying executable or Node entry point directly, preserving
JSON, quotes, Unicode, and multiline arguments. It checks the user's `.local\bin`,
npm globals, WinGet links, and the system-profile `.local\bin` location reported
by some elevated Claude installations. It does not change your global PATH.
Custom batch wrappers are rejected with guidance to use a native executable or
standard npm package.

Login, saved profiles, model discovery, session browsing/resume, self-update,
and the native TUI use Windows paths and processes. Profile editing defaults to
Notepad, honors `VISUAL`/`EDITOR`, and supports `code`/`code-insiders` with `--wait`.
The existing profile location remains `%USERPROFILE%\.subconscious`.

Cursor, Copilot, Codex, and Pi setup use native JSON merges and Node hooks. Other
providers and hooks are preserved; malformed configuration is left unchanged.
Hook credentials are stored in `subconscious-windows.json` within the agent's
user directory; treat that file as a secret. Copilot's model provider still uses
VS Code's secret store and prompts for its key. Its configuration goes under
`%APPDATA%\Code\User` (or Code - Insiders/VSCodium). Rerun install after moving
your Node installation, because hooks record the absolute Node executable path.

To install the native x64 `marathon.exe` (stable releases starting with 0.1.4), clear
any preview version pin from the current PowerShell session:

```powershell
Remove-Item Env:SC_CODE_VERSION -ErrorAction SilentlyContinue
subc.cmd marathon install
subc.cmd marathon
```

The installer requires the selected release's Windows asset and SHA-256
checksum; it reports a clear error if unavailable and never downloads a Unix
binary as a fallback. Windows ARM64 binaries are not currently published.

Run `npm run test:windows` from the repository root for the separate Windows suite. The
Windows CI job also builds/tests the Go TUI. Existing Unix tests and runbooks
remain separate and unchanged.

## Supported agents

The packaged integrations live in `bin/runbook`.

| Command | Behavior |
| --- | --- |
| `subc marathon` | Launch Subconscious Code with the active gateway, key, model, and DLR transport |
| `subc claude` | Launch Claude Code with the runbook environment, context limits, subagent limits, and OTEL usage reporting |
| `subc codex` | Launch Codex with the runbook provider, temporary model catalog, and surgically merged compaction hooks |
| `subc opencode` | Launch OpenCode with the runbook provider, client header, and context/output limits |
| `subc cursor install` | Install/update Cursor conversation and compaction hooks |
| `subc copilot install` | Install/update the VS Code custom endpoint and Copilot hooks |
| `subc pi` | Refresh the Pi provider from the live catalog, then launch |
| `subc dsh` | Launch the DeepSeek Harness Web UI with a temporary provider populated from the live catalog |

## Headless runs

`subc <agent> headless PROMPT [args...]` runs one task without a terminal UI and exits with the agent's status. It works for `claude`, `codex`, `opencode`, `pi`, `marathon`, and `dsh`, and uses the same setup as an interactive launch. It never prompts: there is no update check, a missing agent fails with its install command, stdin is not read, and stdout carries only the agent's own output. Remaining arguments go to the agent, for example `subc claude headless "fix the failing test" --output-format stream-json --verbose`. subc reads `-p`/`--profile` and `--model` itself; put agent options with those names after `--`.

The agents keep their own permission defaults, so a run that should edit files usually needs the agent's permission flags in `[args...]`. For example, `codex exec` uses a read-only sandbox and requires a git repository unless given `--skip-git-repo-check`.

Model, endpoint, and key resolve as for any launch, so a logged-in user needs nothing extra. To point a run somewhere else:

| Input | How to set it |
| --- | --- |
| Model | `--model`, or `SUBCONSCIOUS_MODEL` |
| Endpoint | `SUBCONSCIOUS_BASE_URL`. In a headless run every agent uses it, including Claude Code (`CLAUDE_GATEWAY_URL` is ignored). |
| Key | `SUBCONSCIOUS_API_KEY`, otherwise the `subc login` key |

```bash
SUBCONSCIOUS_BASE_URL=https://gateway.example SUBCONSCIOUS_API_KEY=... \
  subc codex headless "fix the failing test" --model subconscious/deepseek-v4.1-flash-marathon
```

The endpoint must speak the same APIs as the Subconscious gateway: Anthropic Messages for Claude Code, OpenAI Responses for Codex, and OpenAI Chat Completions for the others.

| Agent | Runs |
| --- | --- |
| `claude` | `claude -p -- PROMPT` |
| `codex` | `codex exec -- PROMPT` |
| `opencode` | `opencode run`, with the prompt on stdin |
| `pi` | `pi --print`, with the prompt on stdin |
| `marathon` | `marathon --print=PROMPT` |
| `dsh` | `dsh --profile headless`, with the prompt on stdin |

The prompt is always the argument after `headless`, including for `dsh`, which no longer reads a task piped into subc. Where the table says stdin, subc passes the prompt that way so it reaches the agent unchanged even when it starts with `-` or `@`. On Windows only `dsh` supports headless runs.

The exit status is the agent's own. Pi 1.0.1 exits 1 when the model request fails in its default text output, but 0 with `--mode json`, so check its JSON output for errors. Pi also trims whitespace around a prompt it reads from stdin.

A blank prompt, and `-h` or `--help` anywhere in a headless run, are refused so a scripted run never reports success without doing the task.

Stopping subc with SIGTERM or SIGHUP stops the agent too. SIGKILL cannot be forwarded, so a runner that may kill subc should start it in its own process group and kill the group.

## Harness manifest

`subc harness-manifest` prints how this version of subc installs, configures, and launches each agent above, so other tools can copy the setup exactly instead of re-implementing it.

```bash
subc harness-manifest --json   # full manifest
subc harness-manifest          # summary table in a terminal, JSON when piped
```

The manifest is generated from `agents/registry.json` into `bin/harness-manifest.generated.json`, which ships in the npm package. The command adds `cli_version` from `package.json`.

| Field | Meaning |
| --- | --- |
| `schema_version` | Raised when a field is renamed, removed, or changes meaning. New fields do not raise it. |
| `cli_version` | The installed `subconscious-cli` version. Printed by the command only. |
| `tokens` | Placeholders used in values (listed below). |
| `runbook_env` | What subc passes to every runbook: `order` of the layers, `inherited` sources (profile values, then `process.env`), `fixed` values set last, and `per_harness` extras (Claude's `SUBC_CLAUDE_SETTINGS` and model picker env). |
| `harnesses.<id>` | One entry per agent with a runbook. |

Each `harnesses.<id>` entry has:

| Field | Meaning |
| --- | --- |
| `install` | `method`, `package` or `repository`, `version` or `channel`, `minimum_version`, release `targets`, and the per-OS `commands`. |
| `prerequisites` | Commands the runbook needs, such as `jq`, with what needs them and whether they are required. `a\|b` means either one. |
| `binary` | Executable name, or `null` for IDE integrations. |
| `launch` | `argv` template, `headless_argv` for `subc <agent> headless` (absent when unsupported), `headless_stdin` when the prompt is passed on stdin instead, `headless_platforms` (`darwin`, `linux`, `win32`) where it works, and whether a launch also writes persistent files. |
| `inputs` | Profile or environment variables the runbook reads, with `default` and the `source` file under `bin/runbook`. |
| `env` | Variables the runbook exports to the agent: `value`, what it `controls`, and the `override` variables or flags. |
| `config` | Files, directories, `-c` overrides, flags, and JSON-in-env the runbook writes. |
| `capabilities.compaction` | `default`, plus `on`, `off`, and `threshold`, each with the exact knob and whether subc sets it (`set_by_subc`). |
| `capabilities.mcp` | Whether subc configures MCP, and which transports. |
| `capabilities.headers` | Headers sent and on which requests. |
| `capabilities.hooks` | Hook events installed, what each posts, and where. |

A compaction knob has `kind`, `name`, `value`, and `override`. When `kind` is `config-field` or `model-catalog-field`, `config` names the `config` entry (its `path` or `name`) that holds it. `threshold.semantics` says what the number means: `window` is the context size the agent compacts against (Claude Code, OpenCode, Pi, DeepSeek Harness, Copilot); `trigger` is the token count that starts compaction (Codex).

Enumerated values:

| Field | Values |
| --- | --- |
| `install.method` | `npm`, `script`, `github-release`, `user`, `null` |
| `compaction.default` | `on`, `unknown` |
| knob `kind` | `env`, `cli-config`, `config-field`, `model-catalog-field`, `null` |
| `threshold.semantics` | `window`, `trigger` |
| `config[].kind` | `file`, `dir`, `cli-flag`, `cli-config`, `env-json` |
| `config[].lifetime` | `launch` (removed or not written to disk), `persistent`, `legacy` (left by older setups) |

Placeholders:

| Token | Meaning |
| --- | --- |
| `{baseUrl}`, `{baseUrlV1}` | Gateway origin, and the origin followed by `/v1` |
| `{apiKey}`, `{model}` | Gateway API key and launch model |
| `{catalog}`, `{catalog[N]}` | All live catalog models (newline-separated), or the one at index N (clamped to the last) |
| `{args}`, `{tempFile}`, `{tmp}` | Passed-through arguments, a temporary file the runbook writes (its `config` entry says whether it is removed), the system temp directory |
| `{prompt}` | The task given to `subc <agent> headless` |
| `{json}`, `{claudeSettings}`, `{configOverrides}` | Documents described by the matching `config` entries |
| `{target}` | A release target triple from `install.targets` or `install.windows_targets` |
| `{binDir}`, `{PATH}`, `<install dirs>` | Parts of the `PATH` subc builds |
| `<agent key>` | The agent-specific API key input, such as `CODEX_API_KEY` |
| `<id>`, `models[]` | Any catalog model ID, and every element of a models array |
| `<runbook>` | The installed `bin/runbook` directory |
| `<VS Code user dir>` | The VS Code user settings directory |

`verified: true` means the value was read from what the runbook script does. `verified: false` means subc does not set it, or the scripts cannot prove its effect; a `note` says which.

The tests compare the manifest with the runbooks for these points:

- input defaults in shell scripts
- the full set of `run.sh` exports and their values
- launch commands, and the exact headless argv and stdin (each runbook is run against a stub agent)
- Codex `-c` overrides
- the compaction knobs subc sets (full name and value)
- context and output limits in the config entries
- minimum versions
- the names of headers, hooks, files, and prerequisites

Free-text fields, `controls`, notes, and most config payload fields are not checked.

## Long screenshot sessions

Coding agents resend every screenshot on every turn, so a long computer-use or screenshot session grows until the gateway refuses it. For vision models, subc applies one rule in Pi and OpenCode before a request leaves the machine: keep the newest screenshots, up to 30 and about 25 MiB in total, and put the text `image` where older ones were. It never removes more than one screenshot per turn, because Subconscious Cache reuses around one removed screenshot, not several; a big screenshot can take the total past 25 MiB for a few turns while it catches up, and only past 30 MiB does it drop straight back to 25. The gateway applies the same rule, so it receives exactly what its own window would produce, and Subconscious Cache still reuses the rest of the conversation: each turn only reads the new screenshot.

| Agent | How subc applies it |
| --- | --- |
| OpenCode | A plugin loaded from the launch config (`bin/runbook/opencode/subconscious-image-window.ts`) that gives the provider a trimming `fetch`. |
| Pi | An extension installed with the provider (`bin/runbook/image-window/index.ts`, on `before_provider_request`). |

The rule is in `bin/runbook/image-window/window.js`. `SUBCONSCIOUS_IMAGE_WINDOW_SOFT_MIB` and `SUBCONSCIOUS_IMAGE_WINDOW_HARD_MIB` change the two limits (defaults 25 and 30). Text-only models are left alone, and a request the integrations do not recognize is sent unchanged.

## Sessions and cross-harness handoff

Run `subc` and choose **Coding sessions**, or list the same local catalog from
the shell:

```bash
subc sessions
subc sessions resume claude:SESSION_ID
subc sessions resume claude:SESSION_ID --harness codex
subc sessions resume codex:SESSION_ID --harness opencode
```

The catalog discovers recent sessions written locally by Claude Code, Codex,
OpenCode, Pi, and Subconscious Code. It shows each session's originating
harness, title, last activity, project directory, and model when the harness
records one. Selecting the original harness uses its native resume mechanism.

Selecting Claude Code, Codex, OpenCode, or Pi as a different destination starts
a new session in the original project directory with a portable handoff. The
handoff is limited to the newest 24 user/assistant text messages and 24,000
characters. Tool payloads, tool results, system prompts, and hidden reasoning
are not copied. Source transcripts remain owned by their original harness and
are never rewritten.

Cursor and GitHub Copilot sessions are not listed because their IDE-owned
conversation stores do not expose a stable local resume interface. A session
whose local transcript is missing remains available for native resume but does
not offer cross-harness destinations.

If Subconscious Code, Claude Code, Codex, OpenCode, or DeepSeek Harness is missing, an interactive terminal offers
to install it before launching. Pi refreshes its Subconscious provider on every
`subc pi` launch while preserving all other providers in `models.json`; its
executable must already be installed.

`subc marathon install` detects the operating system and architecture, then downloads
and checksum-verifies the matching precompiled release from
`subconscious-systems/subconscious-code`. Apple Silicon and Intel macOS plus
x86_64 and ARM64 Linux and Windows x64 are supported; Cargo is not required.

Starting with CLI 4.1.1, `subc marathon` is the native agent command. On Windows,
the installer writes `marathon.exe`, avoiding the system `sc.exe` command.
`subc sc` remains a compatibility alias but never launches Windows service
control. Older pinned release binaries are also installed as `marathon.exe`.
Starting with CLI 4.1.2 and native agent 0.1.6, macOS and Linux also install
and launch `marathon`. Existing `.sc` settings, sessions, and `SC_*` variables
are preserved on every platform. Shell behavior is unchanged. Older Unix
release archives are installed under the new name; existing `sc` files are
left untouched. `subc sc` remains a compatibility alias on every platform.

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
optional per-agent key overrides, and all Subconscious Code/Claude/Codex/OpenCode/Pi/Copilot/
DeepSeek Harness context and output settings used by the packaged runbook scripts.

```bash
subc config                         # list every profile and its file path
subc -p staging config create      # create a profile with default settings
subc -p staging config              # print that path and env file
subc -p staging config --model subconscious/glm-5.3-marathon
subc -p staging config --model UNSET
subc -p staging config --subagent-model subconscious/deepseek-v4-flash-marathon
subc -p staging config --subagent-model UNSET
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

Use `UNSET` to clear the profile default so launches use the first model in
the live catalog (gateway priority order).

The subagent setting controls `CLAUDE_CODE_SUBAGENT_MODEL` for Claude Code.
Use `UNSET` to clear the override so subagents automatically follow the
profile's default model.

Each agent section can hold its own API key. An agent-specific key takes
precedence over the shared profile key and can be used on its own, so profiles
do not need an `API_KEY` when every configured agent has an explicit key.

Named profiles work like AWS CLI profiles:

```bash
subc -p staging config \
  --gateway-url https://staging.example \
  --api-key sk-staging-... \
  --model subconscious/glm-5.3-marathon

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
subconscious/glm-5.3-marathon (default)
subconscious/glm-5.2
subconscious/tim-qwen3.6-27b
subconscious/deepseek-v4-flash-marathon
subconscious/deepseek-v4.1-flash-marathon
```

Select a model per run, save it in the current profile, or override it through
the environment:

```bash
subc codex --model subconscious/glm-5.3-marathon
subc config --model subconscious/deepseek-v4-flash-marathon
subc config --subagent-model subconscious/tim-qwen3.6-27b
export SUBCONSCIOUS_MODEL=subconscious/glm-5.3-marathon
```

Every launch and install fetches the same live catalog without caching. Codex,
OpenCode, Pi, Copilot, Cursor, and DeepSeek Harness receive the complete model
list. The selected profile model is listed first only while the gateway still
advertises it.
OpenCode rebuilds its isolated runtime provider on every `subc opencode` launch,
so models left in older OpenCode configuration files do not leak into the list.
If a saved profile default is UNSET or has been removed, launches use the first
live model; an explicit `--model` or `SUBCONSCIOUS_MODEL` override is always
preserved.
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

`subc login` opens a browser to a one-time login link, waits for you to sign in, and saves the API key to the selected runbook profile with mode `600`. For the default profile it also maintains `~/.subconscious/config.json`. The same flow works on a laptop, over SSH, and inside a VM: the browser does not need to be on the machine running the CLI.

If a window does not open, open the login URL printed in the terminal. That URL includes your code. You can also open the printed `/cli/device` link and type the code. To skip the browser, copy an API key from the dashboard and run `subc update-key`.

```bash
subc login
subc update-key sk-new-key-...
subc update-url https://api.subconscious.dev
subc update-platform-url https://platform.subconscious.dev
subc usage
subc usage --json
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

`subc update-platform-url <platform-url>` validates the URL and saves
`PLATFORM_URL` in the active profile. Login, `whoami`, and `usage` call this
host. Production defaults to `https://platform.subconscious.dev`:

```bash
subc update-platform-url https://platform.subconscious.dev
subc config --platform-url http://localhost:3000
```

`SUBCONSCIOUS_URL` overrides the saved profile value for local development.

`subc usage` fetches billing mode, daily token allowance, credit balance,
overage, and per-model consumption from `GET /api/v1/usage` on the resolved
platform host. Pass `--json` for machine-readable output.

`SUBCONSCIOUS_API_KEY` takes precedence over profile and saved config keys,
which is useful for CI and temporary sessions. `subc logout` clears the
selected profile's shared key while preserving its non-secret runbook settings;
logging out of `default` also clears the backwards-compatible saved key.

Existing credentials and profiles under `~/.subcon` are copied into
`~/.subconscious` automatically on first use. The legacy files are left in
place so migration is recoverable.

Set `SUBC_CONFIG_DIR` to keep the saved key and profiles in another directory
instead of `~/.subconscious`. Legacy `~/.subcon` files are not migrated when it
is set.

`subc feedback` sends a message to the Subconscious support team from the
terminal, using the active profile's API key. Pass `-s`/`--subject`,
`-m`/`--message`, and `--image <path>` (JPEG or PNG, repeatable), or run it
without `--message` in a terminal to be prompted:

```bash
subc feedback -s "Bug" -m "Playground won't load"
```

## Contributing

Setup, commit message rules, and local checks are in [CONTRIBUTING.md](CONTRIBUTING.md). `npm install` installs the commit-message hook. Version bumps and the changelog are created by Release Please when a release pull request merges to `main`.
