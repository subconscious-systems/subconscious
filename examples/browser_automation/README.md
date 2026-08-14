# Browse the web with a Subconscious agent

A tiny, client-side agent that drives a **real cloud browser** — point it at a
task and watch it navigate, click, type, and read pages to get the answer. It
pairs **[Subconscious](https://subconscious.dev)** (the model) with a remote
browser from **[Browserbase](https://browserbase.com)** or
**[Kernel](https://onkernel.com)**. **No server, no local browser install** —
the whole agent is three files.

## What you'll learn

- **Subconscious is just the OpenAI API.** Use the official `openai` SDK and
  point it at a different base URL — everything you know transfers.
- **How to build a browser agent loop** — Subconscious runs the *model*; *you*
  run the tools. `main.py` shows the full ask → call tool → feed result → repeat
  cycle in ~100 lines.
- **The one Subconscious-specific knob:** `enable_thinking` (see `run_agent`).
- **A pluggable backend** — Browserbase and Kernel both expose a CDP endpoint,
  so the browser tools are written once against Playwright (`tools.py`) and the
  provider just hands back a connection (`browser.py`). Switch with one env var.

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

Subconscious returns `tool_calls` but does **not** execute them — your code
drives the browser and sends the results back. That loop *is* the agent.

## How it's wired

| File | Role |
|------|------|
| `main.py` | CLI + the agent loop (model ↔ tools) |
| `tools.py` | Browser tools (`navigate`, `click`, `type_text`, `read_page`, `list_links`, `screenshot`) as OpenAI function specs over a Playwright `Page` |
| `browser.py` | Provider layer — creates a Browserbase **or** Kernel browser and returns a CDP connection |

Because we *connect* to a remote browser over CDP, there's no `playwright install`
step — `pip install` is all you need.

## Setup

### 1. Install (Python 3.10+)

```bash
pip install .
cp .env.example .env
```

### 2. Add your keys

Open `.env` and set `SUBCONSCIOUS_API_KEY` (get one at
[subconscious.dev/platform](https://www.subconscious.dev/platform)), then fill in
**one** browser backend:

- **Browserbase** (default): `BROWSERBASE_API_KEY` from
  [browserbase.com](https://browserbase.com) (a project is inferred from the key;
  set `BROWSERBASE_PROJECT_ID` only if your account has several)
- **Kernel**: set `BROWSER_PROVIDER=kernel` and `KERNEL_API_KEY` from
  [onkernel.com](https://onkernel.com)

If you only set one provider's keys, it's auto-detected — `BROWSER_PROVIDER` is
optional.

### 3. Run

```bash
python main.py                                                  # sample task
python main.py "Go to news.ycombinator.com and list the top 5 titles"
python main.py --provider kernel "Search Wikipedia for 'Alan Turing' and summarise the intro"
```

The agent prints each tool call and a **live view URL** so you can watch the
browser work in real time.

## Customise

- **Add a tool** — write a function in `tools.py`, add its spec to
  `OPENAI_TOOL_SPECS`, and register it in `build_tools`. The loop picks it up
  automatically.
- **Add a backend** — implement a `_connect_*` function in `browser.py` that
  returns a `BrowserConnection`, and add it to `_PROVIDERS`.
