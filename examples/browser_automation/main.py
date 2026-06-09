"""Browser-using agent — a client-side tool loop over the Subconscious API.

Subconscious runs the *model*; *you* run the tools. Here the tools drive a real
cloud browser (Browserbase or Kernel) through Playwright. When the model calls a
tool we execute it, feed the result back, and loop until it answers. No server.

    python main.py                                                  # runs a sample task
    python main.py "Go to news.ycombinator.com and list the top 5 titles"
    python main.py --provider kernel "Search Wikipedia for 'Alan Turing' and summarise the intro"

Pick a backend with --provider / BROWSER_PROVIDER, or just set the keys for one
provider and it's auto-detected. See .env.example.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from browser import BrowserSession
from tools import build_tools

load_dotenv()

BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"
MAX_STEPS = 15
WORKSPACE = Path(__file__).parent / "workspace"
DEFAULT_PROMPT = "Go to https://news.ycombinator.com and list the titles of the top 5 stories."

SYSTEM_PROMPT = (
    "You are operating a real web browser through tools. You cannot see the screen; "
    "the only way to observe a page is the snapshot (url, title, text) returned by "
    "each tool, or by calling read_page / list_links. Work step by step: navigate, "
    "observe, then act. Prefer clicking by visible text. When the task is complete, "
    "reply with a concise final answer and no tool calls. "
    f"Save any screenshots under: {WORKSPACE.resolve()}"
)


def call_tool(functions: dict[str, Any], name: str, arguments_json: str) -> str:
    """Run one tool call and return its JSON result. Failures come back as a JSON
    error so the model can see them and recover — we never crash the loop."""
    fn = functions.get(name)
    if fn is None:
        return json.dumps({"status": "error", "message": f"unknown tool {name!r}"})
    try:
        return json.dumps(fn(**json.loads(arguments_json)))
    except Exception as exc:
        return json.dumps({"status": "error", "message": str(exc)})


def run_agent(client: OpenAI, prompt: str, specs: list, functions: dict) -> str:
    """model -> tool calls -> results -> ... until the model replies with no tool calls."""
    messages: list[Any] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]

    for _ in range(MAX_STEPS):
        msg = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=specs,  # type: ignore[arg-type]
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        ).choices[0].message

        if not msg.tool_calls:
            return msg.content or ""

        # Record the assistant turn (tool_calls must precede their tool results).
        messages.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        })
        for tc in msg.tool_calls:
            print(f"  [tool] {tc.function.name}({tc.function.arguments})")
            result = call_tool(functions, tc.function.name, tc.function.arguments)
            print(f"  [result] {result[:300]}")
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "Stopped: reached the step limit without finishing."


def main() -> None:
    parser = argparse.ArgumentParser(description="Browse the web with a Subconscious agent.")
    parser.add_argument("prompt", nargs="?", default=DEFAULT_PROMPT, help="task for the agent")
    parser.add_argument("--provider", choices=["browserbase", "kernel"],
                        help="browser backend (overrides BROWSER_PROVIDER)")
    args = parser.parse_args()

    api_key = os.getenv("SUBCONSCIOUS_API_KEY")
    if not api_key:
        sys.exit("SUBCONSCIOUS_API_KEY is not set — get one at https://subconscious.dev/platform")
    if args.provider:
        os.environ["BROWSER_PROVIDER"] = args.provider

    WORKSPACE.mkdir(exist_ok=True)
    client = OpenAI(base_url=BASE_URL, api_key=api_key)

    print(f'Task: "{args.prompt}"\n')
    with BrowserSession() as session:
        conn = session.connection
        print(f"Browser: {conn.provider}")
        if conn.live_view_url:
            print(f"Live view: {conn.live_view_url}")
        print()
        specs, functions = build_tools(session.page)
        answer = run_agent(client, args.prompt, specs, functions)

    print(f"\n{answer}")


if __name__ == "__main__":
    main()
