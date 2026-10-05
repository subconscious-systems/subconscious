# Coding-agent integrations

Each directory here is one agent. Its `agent.json` is the only place that
agent's data is written; the code reads it at runtime. `shared.json` lists the
agents in menu order and holds what is truly shared: the packaged model list,
the default gateway, model capabilities, and the settings every agent uses
(`GATEWAY_URL`, `API_KEY`, `MODEL`, `MAX_CONCURRENT_SUBAGENTS`).

| Agent | Launch | Setup |
| --- | --- | --- |
| `claude-code` | binary | `install.sh` (leftover status/uninstall) |
| `codex` | `run.sh` | `install.sh` (hooks) |
| `opencode` | binary | `install.sh` (leftover status/uninstall) |
| `cursor` | none | `install.sh` (hooks) |
| `copilot` | none | `install.sh` (provider and hooks) |
| `pi` | `run.sh` | `install.sh` (provider and extensions) |
| `deepseek-harness` | `run.sh` | none |

## What `agent.json` holds and who reads it

| Field | Read by |
| --- | --- |
| `id`, `command`, `aliases`, `name`, `description` | routing, `subc help`, the TUI menu |
| `install` | the installer prompt, `--version` warning (`minimum_version`), Windows installs; `{package}` fills in the commands |
| `runbook` | which script launches the agent (none means the binary is run directly) and which setup actions exist |
| `help` | `subc <agent> help`; flags with a `help` text are added from `inputs` |
| `sessions`, `launch.resume`, `launch.handoff` | `subc sessions resume` |
| `launch.argv`, `launch.headless_argv`, `headless_stdin`, `headless_platforms` | every launch: subc builds the full argv and stdin from these |
| `inputs` | profile settings and the TUI (`label`, `type`, `min`, `max`, `choices`), the new-profile template, launch flags (`flag`), and defaults (`default`, `aliases`, `keep_empty`) |
| `env` | the env subc gives the agent: the first set `override`, otherwise `value` |
| `config` | `cli-config` entries become `config_flag NAME=VALUE` (Codex `-c`) when `when` holds; other entries describe files the runbooks write |
| `capabilities`, `prerequisites` | the harness manifest only |

Values may use `{baseUrl}`, `{baseUrlV1}`, `{apiKey}`, `{model}`, `{prompt}`,
`{args}`, `{config}`, and `${NAME}` for another input or env entry.
`subc harness-manifest --json` prints every agent file with `${NAME}` replaced
by its default, so readers such as bench-runner parse JSON instead of these
scripts.

## The runbook contract

subc starts a runbook as `bash run.sh ARGV...`, where `ARGV` is the agent's
complete command line. The env already holds every input with its default,
every `env` entry, `SUBC_MODEL_IDS` (launch model first, then the catalog),
and `SUBC_VISION_MODELS`. A runbook does its own work, such as writing a
temporary file, and ends with `subc_exec` from `lib.sh`, which replaces a
`{tempFile}` placeholder in the template words and execs the agent. A runbook
declares no defaults, flags, or argv of its own.

Setup scripts (`install.sh`) get the same inputs and keep their own
`install|status|uninstall` command line.

## Adding or changing an agent

1. Create `bin/runbook/<id>/agent.json` (copy the closest agent) and add the
   id to `shared.json`.
2. Add `run.sh` only if the launch must do work subc cannot express as data,
   such as writing a file; otherwise leave `runbook.script` out.
3. Run `npm test`. `test/agent-files.test.js` validates every agent file and
   renders each launch template.

To change a default, flag, env value, argv, or help text, edit the agent file.
The launcher, profiles, help, Windows launcher, and manifest all read it. The
contents of files a runbook writes (the Codex catalog, Pi's provider, the
DeepSeek Harness overlay, Copilot's provider) live in that script, and on
Windows in `bin/windows/launch.js` and `bin/windows/setup.js`, whose Codex
`-c` list also differs from the one in `agent.json`.
