# Build an AI agent on Subconscious (with real app tools)

A tiny, client-side AI agent that can act on real apps — star a GitHub repo, send a
Gmail, etc. It pairs **[Subconscious](https://subconscious.dev)** (the model) with
**[Composio](https://composio.dev)** (OAuth + tools for 1000+ apps). **No server** —
the whole thing is one file, `main.py`.

## What you'll learn

- **Subconscious is just the OpenAI API.** You use the official `openai` SDK and point it at a different base URL. Everything you know transfers.
- **How to build an agent loop** — Subconscious runs the *model*; *you* run the tools. This file shows the full ask → call tools → feed results → repeat cycle in ~80 lines.
- **The one Subconscious-specific knob:** `enable_thinking` (see `ask_model` in `main.py`).
- **A scalable tool pattern** — an app can have 800+ tools, so the agent *searches* for the tools it needs instead of being handed all of them.

## The key idea

```python
import openai

client = openai.OpenAI(
    base_url="https://api.subconscious.dev/v1",   # ← the only difference from OpenAI
    api_key="sky_...",
)

client.chat.completions.create(
    model="subconscious/tim-qwen3.6-27b",
    messages=[...],
    tools=[...],                                   # standard OpenAI function tools
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},  # ← Subconscious knob
)
```

Subconscious returns `tool_calls` but does **not** execute them — your code does, then
sends the results back. That loop *is* the agent.

## Setup

### 1. Install (Python 3.10+)

```bash
pip install .            # installs openai + composio (pinned to 0.13.1)
cp .env.example .env      # you'll paste two keys here in step 2
```

> Use the same interpreter for install and run — if `pip` is your Python 3 pip, run
> the examples with `python3 main.py ...` (or use a venv). Mixing `python` (older) and
> `python3` is the #1 setup gotcha.

### 2. Get your two API keys

| Variable | How to get it |
|---|---|
| `SUBCONSCIOUS_API_KEY` | Sign up at [subconscious.dev/platform](https://subconscious.dev/platform) → copy your key. Starts with `sky_`. |
| `COMPOSIO_API_KEY` | Sign up at [dashboard.composio.dev](https://dashboard.composio.dev) → **Settings / API Keys** → copy. Starts with `ak_`. |

Paste both into `.env`. Tip: click the key's **copy button** rather than selecting the
masked text — copying the visible dots gives you a truncated, invalid key.

### 3. Set up your apps in Composio (one-time, per app)

This is the step people miss. Before the agent can touch an app, that app needs an
**Auth Config** in Composio — this is what tells Composio how to log users in. Without
it, `connect github` fails with *"No auth config for 'github'."*

In the [Composio dashboard](https://dashboard.composio.dev):

1. Go to **Auth Configs** in the left sidebar (or open the app under **Toolkits**).
2. Click **Create Auth Config** and pick the app (e.g. **GitHub**).
3. Choose **Use Composio-managed auth** — Composio provides the OAuth app, so you don't
   need to register your own OAuth credentials. (You *can* bring your own for production.)
4. Save. Repeat for any other app you want the agent to use (Gmail, Slack, …).

That's the whole Composio setup. You only do it once per app.

## Usage

```bash
# 1. Connect YOUR account to an app you set up in step 3.
#    Prints an OAuth URL — open it and approve. (Composio hosts the callback; no server needed.)
python3 main.py connect github

# 2. Confirm it connected.
python3 main.py connections

# 3. Run the agent.
python3 main.py run "Star the composiohq/composio repo on GitHub"
```

Scope a run to specific apps with `--toolkits` (faster, more focused):

```bash
python3 main.py run --toolkits gmail "Email hello@example.com a quick hi"
```

When `--toolkits` is omitted, the agent uses whatever apps you've connected.

> **Auth Config vs. connection:** the Auth Config (step 3, dashboard) is set up *once per
> app* and defines how login works. `connect` (above) links *your* account to it via OAuth.
> Connections are scoped to a single user (`"default"`); set `COMPOSIO_USER_ID` to use another.

## How the agent loop works

An app toolkit (e.g. GitHub) can expose **800+ tools** — far too many to hand the model
at once. So the agent **discovers tools on demand**:

1. **Search meta-tool** — the model starts with one built-in tool, `search_tools(query)`, and greps for the capability it needs.
2. **Dynamic tool set** — matches become callable on the next turn, capped at `MAX_ACTIVE_TOOLS` so context never overflows.
3. **Execute & feed back** — when the model calls a real tool, `main.py` runs it via Composio, truncates the result, and appends it as a `role: "tool"` message.
4. **Answer** — when the model replies with no `tool_calls`, that's the final answer.

### Things this handles for you

- `max_tokens` bounded on every call (Subconscious caps completions at 5000).
- Tool results + active tool count capped, so nothing overflows the context window.
- Local tool-name ranking augments Composio's search (much better recall).
- Composio quirks: schema sanitising (`strict: null`), concrete tool versions for execution, and retries on transient errors.
- If the model leaks raw markup, it's stripped into a clear message.

## File structure

One file — `main.py`, top to bottom:

1. **Config** — base URL, model, the `enable_thinking` knob, limits.
2. **The lesson** — the Subconscious agent loop (`ask_model`, `run_agent`).
3. **Composio** — fetching tools, executing them, and the OAuth connection commands.
4. **CLI** — `run`, `connect`, `connections`.
