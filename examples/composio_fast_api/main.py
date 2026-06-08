"""Build an AI agent on Subconscious that can act on real apps (GitHub, Gmail, …).

WHAT THIS TEACHES
-----------------
Subconscious is an OpenAI-compatible LLM API. If you know the OpenAI SDK, you
already know Subconscious — you just point the client at a different base URL:

    client = openai.OpenAI(base_url="https://api.subconscious.dev/v1", api_key=...)

Subconscious runs the *model*, but it does NOT run tools for you. So to build an
agent you run a small "tool loop" yourself (this file). The loop:

    1. Ask the model what to do, handing it a list of tools.
    2. If it replies with `tool_calls`, run them and feed the results back.
    3. Repeat until the model answers in plain text.

Tools here come from Composio, which gives any app a set of OpenAI-style tool
schemas and an OAuth login flow — so your agent can act as a real user.

There is no server. Everything runs in this one process.

QUICK START
-----------
    pip install .
    cp .env.example .env          # then paste your two API keys
    python main.py connect github # one-time: approve OAuth in the browser
    python main.py run "Star the composiohq/composio repo on GitHub"

The only Subconscious-specific knob is `enable_thinking` (see `ask_model`).
Everything else is plain OpenAI.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Any

import dotenv
import openai
from composio import Composio
from composio.core.provider._openai import OpenAIProvider

# ── Config ───────────────────────────────────────────────────────────────────

SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"

ENABLE_THINKING = False  # Subconscious-specific. On by default; off = fast, clean tool turns.
MAX_TOKENS = 2048        # Subconscious caps completions at 5000; bound every call.
MAX_STEPS = 12           # Safety limit on tool-loop iterations.

TOOL_SEARCH_LIMIT = 10   # Tools returned per search.
MAX_ACTIVE_TOOLS = 20    # Cap on tools held in context at once (a toolkit can have 100s).
MAX_TOOL_RESULT_CHARS = 6000  # Truncate big results so they don't overflow the context window.

# Composio scopes connections per end-user. This demo uses one fixed user.
USER_ID = os.environ.get("COMPOSIO_USER_ID", "default")

# Where to get each key — shown when one is missing.
KEY_HELP = {
    "SUBCONSCIOUS_API_KEY": "https://subconscious.dev/platform",
    "COMPOSIO_API_KEY": "https://dashboard.composio.dev",
}

# Quiet the HTTP/SDK chatter so the demo output stays readable. Without this the
# terminal fills with "INFO HTTP Request: ..." lines from httpx/composio.
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
for _noisy in ("httpx", "httpcore", "openai", "composio"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)


def say(message: str) -> None:
    """Print human-facing progress to stderr (stdout stays clean for the answer)."""
    print(message, file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LESSON: an agent loop on the Subconscious API
# ═══════════════════════════════════════════════════════════════════════════════


def ask_model(client: openai.OpenAI, messages: list[dict], tools: list[dict] | None) -> Any:
    """One turn of the conversation with Subconscious.

    This is a standard OpenAI Chat Completions call. The ONE Subconscious-specific
    detail is `enable_thinking`, passed via `extra_body` — turn it off for crisp
    tool-calling, on for hard reasoning.
    """
    completion = client.chat.completions.create(
        model=MODEL,
        messages=messages,  # type: ignore[arg-type]
        tools=tools or None,  # type: ignore[arg-type]  # omit the param when we have no tools
        max_tokens=MAX_TOKENS,
        extra_body={"chat_template_kwargs": {"enable_thinking": ENABLE_THINKING}},
    )
    return completion.choices[0].message


SYSTEM_PROMPT = (
    "You are a helpful assistant that acts on the user's connected apps via tools. "
    "An app can expose hundreds of tools, so you don't get them all up front. Call "
    "`search_tools` with keywords (e.g. 'star repository', 'send email') to discover "
    "the tools you need — they then become callable. Search again with different "
    "keywords if the results don't fit. When you're done, reply in plain text."
)


def run_agent(user_id: str, instructions: str, api_key: str, toolkits: list[str] | None) -> str:
    """Run the tool loop until the model produces a final text answer."""
    # Only let the agent discover tools from apps the user has actually connected,
    # so everything it finds is runnable.
    if not toolkits:
        toolkits = connected_toolkits(user_id)
        if not toolkits:
            raise RuntimeError("No connected apps. Run `connect <toolkit>` first (e.g. connect github).")

    client = openai.OpenAI(api_key=api_key, base_url=SUBCONSCIOUS_BASE_URL)
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": instructions},
    ]
    # Tools discovered so far (name -> schema). Starts with just `search_tools`;
    # grows as the model greps for what it needs. Capped to MAX_ACTIVE_TOOLS.
    active: dict[str, dict] = {}

    for _ in range(MAX_STEPS):
        msg = ask_model(client, messages, [SEARCH_TOOL, *active.values()])

        # No tool calls → the model is done; this is the answer.
        if not msg.tool_calls:
            return clean_answer(msg.content)

        # Otherwise: record the model's tool calls, run each, append the results,
        # and loop. (This back-and-forth is the whole "agent" — Subconscious only
        # decides; we execute.)
        assistant_turn = {
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [_tool_call_dict(tc) for tc in msg.tool_calls],
        }
        results = [_handle_call(tc, user_id, toolkits, active) for tc in msg.tool_calls]
        messages = [*messages, assistant_turn, *results]

    # Ran out of steps — ask once more for a plain answer instead of erroring out.
    say("⚠️  Hit the step limit; asking for a final answer.")
    messages = [*messages, {"role": "user",
                            "content": "Stop using tools and answer now with what you have, "
                                       "or briefly say what you couldn't accomplish."}]
    return clean_answer(ask_model(client, messages, None).content)


def _handle_call(tc: Any, user_id: str, toolkits: list[str], active: dict[str, dict]) -> dict:
    """Dispatch one tool call to either tool-search or real execution."""
    if tc.function.name == SEARCH_TOOL_NAME:
        result, found = search_tools(tc, user_id, toolkits)
        active.clear()
        active.update(_capped(found))
        return result
    return run_tool(tc, user_id)


def _capped(found: list[dict]) -> dict[str, dict]:
    """Keep the most recent discovered tools, bounded by MAX_ACTIVE_TOOLS."""
    by_name = {t["function"]["name"]: t for t in found}
    if len(by_name) <= MAX_ACTIVE_TOOLS:
        return by_name
    return dict(list(by_name.items())[-MAX_ACTIVE_TOOLS:])


def _tool_call_dict(tc: Any) -> dict:
    """Serialize a tool call back into the message shape the API expects."""
    return {
        "id": tc.id,
        "type": "function",
        "function": {"name": tc.function.name, "arguments": tc.function.arguments},  # type: ignore[union-attr]
    }


# Subconscious is a Qwen model. When no available tool fits the task it sometimes
# emits raw tool-call markup as text instead of answering. Strip it so users never
# see `<tool_call></think>` noise; fall back to a clear message if nothing's left.
_MARKUP = re.compile(r"</?think>|</?tool_call>|<tool_use_form>.*", re.DOTALL)


def clean_answer(content: str | None) -> str:
    cleaned = _MARKUP.sub("", content or "").strip()
    return cleaned or (
        "I couldn't complete that with the connected tools. Try rephrasing, or "
        "connect the relevant app (e.g. `python main.py connect github`)."
    )


def run_tool(tc: Any, user_id: str) -> dict:
    """Execute one real tool call and format it as a `role: tool` reply message."""
    name = tc.function.name
    try:
        arguments = json.loads(tc.function.arguments)
    except json.JSONDecodeError as exc:
        return _tool_reply(tc.id, {"error": f"malformed arguments: {exc}"})

    say(f"🔧 {name}({_short_args(arguments)})")
    try:
        result = execute_tool(name, arguments, user_id)
    except Exception as exc:  # noqa: BLE001 — feed any tool failure back to the model
        say(f"   ⚠️  tool failed: {exc}")
        return _tool_reply(tc.id, {"error": str(exc)})
    return _tool_reply(tc.id, result)


def _tool_reply(call_id: str, payload: dict) -> dict:
    body = json.dumps(payload, default=str)[:MAX_TOOL_RESULT_CHARS]
    return {"role": "tool", "tool_call_id": call_id, "content": body}


def _short_args(arguments: dict) -> str:
    return ", ".join(f"{k}={v}" for k, v in list(arguments.items())[:4])


# ═══════════════════════════════════════════════════════════════════════════════
#  Composio: the Composio client, tools, and execution
# ═══════════════════════════════════════════════════════════════════════════════

_composio: Composio | None = None


def composio() -> Composio:
    """The Composio client (one per process). Reads COMPOSIO_API_KEY from the env.

    The OpenAIProvider makes `tools.get(...)` return schemas already shaped like
    OpenAI function tools, so they drop straight into the chat call above.
    """
    global _composio  # noqa: PLW0603 — intentional singleton
    if _composio is None:
        _composio = Composio(provider=OpenAIProvider())
    return _composio


def fetch_tools(user_id: str, *, toolkits: list[str] | None, search: str | None, limit: int) -> list[dict]:
    """Get OpenAI-format tool schemas for a user, sanitised for Subconscious."""
    raw = composio().tools.get(user_id, toolkits=toolkits, search=search, limit=limit)
    tools = []
    for tool in raw:
        tool = tool if isinstance(tool, dict) else json.loads(json.dumps(tool))
        fn = tool.get("function")
        # Composio emits `function.strict: null`; Subconscious requires a bool, so drop it.
        if isinstance(fn, dict) and not isinstance(fn.get("strict"), bool):
            tool = {**tool, "function": {k: v for k, v in fn.items() if k != "strict"}}
        tools.append(tool)
    return tools


def execute_tool(slug: str, arguments: dict, user_id: str) -> dict:
    """Run a Composio tool on behalf of the user, with retries on transient errors."""
    c = composio()

    def _do() -> dict:
        resp = c.tools.execute(
            slug=slug,
            arguments=arguments,
            user_id=user_id,
            # Use the toolkit's current version. For production, pin versions via
            # Composio(toolkit_versions={...}) so tool updates can't surprise you.
            dangerously_skip_version_check=True,
        )
        return resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)  # type: ignore[attr-defined]

    return _with_retries(_do)


def _with_retries(fn: Any, *, attempts: int = 3, base_delay: float = 1.0) -> Any:
    """Run *fn*, retrying transient API/network errors with exponential backoff."""
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — retry any error, then re-raise
            last_exc = exc
            if i < attempts - 1:
                time.sleep(base_delay * (2 ** i))
    raise last_exc  # type: ignore[misc]


# ── Tool discovery (the `search_tools` meta-tool) ─────────────────────────────
#
# A toolkit like GitHub has 800+ tools — far too many to hand the model at once.
# So we give it ONE built-in tool, `search_tools`, and let it grep for what it
# needs on demand.

SEARCH_TOOL_NAME = "search_tools"
SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": SEARCH_TOOL_NAME,
        "description": (
            "Search the connected apps' tools by keyword and make the matches "
            "callable. Use when you don't already have a tool for the task."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords for the capability you need."}
            },
            "required": ["query"],
        },
    },
}


def search_tools(tc: Any, user_id: str, toolkits: list[str]) -> tuple[dict, list[dict]]:
    """Handle a `search_tools` call: returns (tool-reply message, found schemas)."""
    try:
        query = json.loads(tc.function.arguments).get("query", "").strip()
    except json.JSONDecodeError:
        query = ""

    say(f"🔍 searching tools: {query!r}")
    found = _find_tools(user_id, toolkits, query) if query else []
    summary = [
        {"name": t["function"]["name"], "description": (t["function"].get("description") or "")[:120]}
        for t in found
    ]
    payload = {"found": summary} if summary else {"found": [], "note": "No tools matched; try other keywords."}
    return _tool_reply(tc.id, payload), found


# Composio's text search has weak recall for loose queries, so we also rank the
# full toolkit locally by how many query words appear in each tool's name, and
# merge the two result sets.
_SYNONYMS = {"my": "authenticated", "mine": "authenticated", "me": "authenticated", "i": "authenticated"}
_tool_index: dict[frozenset, list[dict]] = {}


def _toolkit_index(user_id: str, toolkits: list[str]) -> list[dict]:
    """Every tool for these toolkits, fetched once per process and cached."""
    key = frozenset(toolkits)
    if key not in _tool_index:
        say(f"⚙️  indexing {', '.join(toolkits)} tools (one-time)...")
        _tool_index[key] = fetch_tools(user_id, toolkits=toolkits, search=None, limit=1000)
    return _tool_index[key]


def _name_score(name: str, tokens: list[str]) -> int:
    lowered = name.lower()
    return sum((2 if len(t) > 4 else 1) for t in (_SYNONYMS.get(w, w) for w in tokens) if t in lowered)


def _find_tools(user_id: str, toolkits: list[str], query: str) -> list[dict]:
    """Local name-ranking (high recall) merged with Composio search, deduped."""
    tokens = [w for w in re.split(r"\W+", query.lower()) if len(w) > 1]
    index = _toolkit_index(user_id, toolkits)
    ranked = sorted(index, key=lambda t: _name_score(t["function"]["name"], tokens), reverse=True)
    local = [t for t in ranked if _name_score(t["function"]["name"], tokens) > 0][:TOOL_SEARCH_LIMIT]
    remote = fetch_tools(user_id, toolkits=toolkits, search=query, limit=TOOL_SEARCH_LIMIT)

    found, seen = [], set()
    for tool in [*local, *remote]:
        name = tool["function"]["name"]
        if name not in seen:
            seen.add(name)
            found.append(tool)
    return found[:TOOL_SEARCH_LIMIT]


# ═══════════════════════════════════════════════════════════════════════════════
#  Composio: connections (OAuth)
# ═══════════════════════════════════════════════════════════════════════════════


def _items(result: Any) -> list[Any]:
    return list(result.items if hasattr(result, "items") else result)


def list_connections(user_id: str) -> list[dict]:
    """Every app the user has connected (never includes the raw OAuth tokens)."""
    return [
        {"toolkit": getattr(getattr(a, "toolkit", None), "slug", None) or "unknown",
         "account_id": getattr(a, "id", None)}
        for a in _items(composio().connected_accounts.list(user_ids=[user_id]))
    ]


def check_connection(user_id: str, toolkit: str) -> bool:
    accts = composio().connected_accounts.list(user_ids=[user_id], toolkit_slugs=[toolkit])
    return len(_items(accts)) > 0


def connected_toolkits(user_id: str) -> list[str]:
    return sorted({c["toolkit"] for c in list_connections(user_id) if c["toolkit"] != "unknown"})


def connect(user_id: str, toolkit: str) -> str:
    """Start OAuth for a toolkit and return the URL the user opens to approve it."""
    configs = _items(composio().auth_configs.list(toolkit_slug=toolkit))
    if not configs:
        raise RuntimeError(
            f"No auth config for '{toolkit}'. Create one (free, Composio-managed OAuth) "
            f"at https://dashboard.composio.dev/auth-configs (+ Create), then retry."
        )
    req = composio().connected_accounts.link(user_id=user_id, auth_config_id=configs[0].id)
    url = getattr(req, "redirect_url", None) or getattr(req, "redirectUrl", None)
    if not url:
        raise RuntimeError("Composio did not return a redirect URL.")
    return url


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════════════════


def require_keys(*names: str) -> None:
    """Exit with a friendly message (and where to get the key) if one is missing."""
    for name in names:
        if not os.environ.get(name):
            sys.exit(f"✖ Missing {name}\n  Get it at {KEY_HELP[name]} and add it to your .env file.")


def cmd_run(args: argparse.Namespace) -> None:
    require_keys("SUBCONSCIOUS_API_KEY", "COMPOSIO_API_KEY")
    toolkits = [t.strip() for t in args.toolkits.split(",") if t.strip()] if args.toolkits else None
    answer = run_agent(USER_ID, args.instructions, os.environ["SUBCONSCIOUS_API_KEY"], toolkits)
    say("")  # blank line between progress and the answer
    print(answer)


def cmd_connect(args: argparse.Namespace) -> None:
    require_keys("COMPOSIO_API_KEY")
    if check_connection(USER_ID, args.toolkit):
        print(f"✓ {args.toolkit} is already connected. Try:  python main.py run \"...\"")
        return
    url = connect(USER_ID, args.toolkit)
    print(f"🔗 Connect {args.toolkit}: open this URL and approve access:\n\n   {url}\n")
    print("Then verify with:  python main.py connections")


def cmd_connections(args: argparse.Namespace) -> None:
    require_keys("COMPOSIO_API_KEY")
    if args.toolkit:
        ok = check_connection(USER_ID, args.toolkit)
        print(f"{'✓' if ok else '✗'} {args.toolkit}: {'connected' if ok else 'not connected'}")
        return
    apps = list_connections(USER_ID)
    if not apps:
        print("No apps connected yet. Connect one with:  python main.py connect <toolkit>")
        return
    print("Connected apps:")
    for app in apps:
        print(f"  ✓ {app['toolkit']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="A client-side AI agent on Subconscious, with tools from Composio.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run the agent on an instruction.")
    run.add_argument("instructions", help='What you want done, e.g. "Star the composiohq/composio repo".')
    run.add_argument("--toolkits", help="Limit to specific apps, comma-separated (e.g. github,gmail).")
    run.set_defaults(func=cmd_run)

    con = sub.add_parser("connect", help="Connect an app via OAuth.")
    con.add_argument("toolkit", help="App slug, e.g. github or gmail.")
    con.set_defaults(func=cmd_connect)

    lst = sub.add_parser("connections", help="List connected apps, or check one.")
    lst.add_argument("toolkit", nargs="?", help="Optional app slug to check.")
    lst.set_defaults(func=cmd_connections)
    return parser


def main() -> None:
    dotenv.load_dotenv()
    args = build_parser().parse_args()
    # Turn any SDK/API error into a clean one-liner instead of a stack trace.
    try:
        args.func(args)
    except RuntimeError as exc:
        sys.exit(f"✖ {exc}")
    except Exception as exc:  # noqa: BLE001 — top-level CLI guard
        sys.exit(f"✖ {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
