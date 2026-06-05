"""ReAct agent loop using native OpenAI function tools."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Optional

from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from utils.client import MODEL
from utils.search import format_search_results, web_search

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_STEPS = 15

# Native OpenAI function tool definition for web_search.
_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the web via DuckDuckGo. Returns a numbered list of titles, "
                "URLs, and snippets. Use this to gather current information before answering."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to look up.",
                    }
                },
                "required": ["query"],
            },
        },
    }
]

_SYSTEM_PROMPT = """\
You are a research assistant with access to a web_search tool.
Search at least once before giving a final answer when the question requires
up-to-date information.
Format your final answer for terminal display: plain text, no LaTeX,
no markdown syntax like ** or ##.
"""


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AgentEvent:
    """An event emitted by the agent loop for UI rendering."""

    kind: Literal["thinking", "tool_call", "tool_result", "tool_error", "final", "error"]
    tool: Optional[str] = None
    args: Optional[Dict[str, Any]] = None
    result: Optional[str] = None
    content: Optional[str] = None
    error: Optional[str] = None


EventCallback = Callable[[AgentEvent], None]


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


def run_agent(
    client: OpenAI,
    question: str,
    on_event: Optional[EventCallback] = None,
    max_steps: int = MAX_STEPS,
    enable_thinking: bool = False,
) -> str:
    """
    Run the ReAct agent loop to answer a question using native OpenAI function tools.

    The loop:
      1. Sends messages + tools to the model.
      2. If the model emits tool_calls, executes each function locally and
         feeds all results back as role="tool" messages.
      3. Repeats until the model returns a plain content reply (no tool_calls)
         or max_steps is reached.

    Args:
        client: Configured OpenAI-compatible client.
        question: The user's research question.
        on_event: Optional callback receiving AgentEvent objects for live UI updates.
        max_steps: Guard against infinite loops (default: 15).
        enable_thinking: Enable Subconscious extended thinking (default: False).

    Returns:
        The final answer string.

    Raises:
        RuntimeError: If the loop exceeds max_steps without a final answer.
    """
    emit: EventCallback = on_event if on_event is not None else _noop

    messages: List[ChatCompletionMessageParam] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]

    for _step in range(max_steps):
        emit(AgentEvent(kind="thinking"))

        messages = _call_model(client, messages, enable_thinking)
        last_message = messages[-1]

        # Native tool_calls path: last message is the assistant turn we just appended.
        tool_calls = (last_message.get("tool_calls") or []) if isinstance(last_message, dict) else []  # type: ignore[union-attr]

        if not tool_calls:
            # No tool calls — the assistant's content is the final answer.
            content: str = (last_message.get("content") or "") if isinstance(last_message, dict) else ""  # type: ignore[union-attr]
            emit(AgentEvent(kind="final", content=content))
            return content

        # Execute every requested tool and collect result messages.
        tool_result_messages = _execute_tool_calls(tool_calls, emit)
        messages = [*messages, *tool_result_messages]

    raise RuntimeError(
        f"Agent exceeded {max_steps} steps without reaching a final answer."
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _call_model(
    client: OpenAI,
    messages: List[ChatCompletionMessageParam],
    enable_thinking: bool,
) -> List[ChatCompletionMessageParam]:
    """
    Send messages to the model and return the updated message list with the
    assistant reply appended.

    `chat_template_kwargs` is a Subconscious vendor extension and must travel
    through `extra_body` — the OpenAI SDK rejects unknown top-level kwargs.
    """
    completion = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=_TOOLS,  # type: ignore[arg-type]
        extra_body={"chat_template_kwargs": {"enable_thinking": enable_thinking}},
    )
    msg = completion.choices[0].message

    # Build the assistant message dict to append to history.
    assistant_message: Dict[str, Any] = {
        "role": "assistant",
        "content": msg.content,
    }
    if msg.tool_calls:
        assistant_message["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in msg.tool_calls
        ]

    return [*messages, assistant_message]  # type: ignore[return-value]


def _execute_tool_calls(
    tool_calls: List[Dict[str, Any]],
    emit: EventCallback,
) -> List[ChatCompletionMessageParam]:
    """
    Execute each tool call in the list and return a list of role="tool" messages.

    Args:
        tool_calls: The tool_calls list from the assistant message.
        emit: Event callback for live UI updates.

    Returns:
        A list of tool-result messages ready to append to the conversation.
    """
    result_messages: List[ChatCompletionMessageParam] = []

    for tc in tool_calls:
        tool_name: str = tc["function"]["name"]
        raw_args: str = tc["function"]["arguments"]
        tool_call_id: str = tc["id"]

        try:
            args: Dict[str, Any] = json.loads(raw_args)
        except json.JSONDecodeError as exc:
            error_text = f"ERROR: malformed tool arguments JSON: {exc}"
            emit(AgentEvent(kind="tool_error", tool=tool_name, error=error_text))
            result_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": error_text,
                }
            )
            continue

        emit(AgentEvent(kind="tool_call", tool=tool_name, args=args))
        tool_result = _dispatch_tool(tool_name, args)

        if tool_result.startswith("ERROR:"):
            emit(AgentEvent(kind="tool_error", tool=tool_name, error=tool_result))
        else:
            emit(AgentEvent(kind="tool_result", tool=tool_name, result=tool_result))

        # content must be a string — JSON-encoding is safe but plain text is fine here.
        result_messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": tool_result,
            }
        )

    return result_messages


def _dispatch_tool(tool_name: str, args: Dict[str, Any]) -> str:
    """
    Execute a client-side tool and return its result as a formatted string.

    Args:
        tool_name: Name of the tool to execute.
        args: Parsed arguments dict from the model.

    Returns:
        Formatted result string. On error, returns a string starting with "ERROR:".
    """
    if tool_name == "web_search":
        query = str(args.get("query", "")).strip()
        if not query:
            return "ERROR: web_search requires a non-empty 'query' argument."
        try:
            results = web_search(query)
            return format_search_results(results)
        except (ValueError, RuntimeError) as exc:
            return f"ERROR: {exc}"

    return f"ERROR: Unknown tool '{tool_name}'. Available tools: web_search."


def _noop(_event: AgentEvent) -> None:
    """No-op event callback used when the caller passes no callback."""
