"""Client-side tool loop for the image-editing example.

Uses native OpenAI function tools — no response_format workaround.

Loop:
1. Send messages + tools to the Subconscious chat-completions endpoint.
2. If the model returns tool_calls, execute each function locally,
   append the assistant message (with tool_calls) and a ``role: tool``
   result message for every call, then repeat.
3. When no tool_calls are present the model's content is the final answer.
4. A max-steps guard prevents infinite loops.
"""

import json
import logging
from typing import Any

import openai

from tools import TOOL_FUNCTIONS, OPENAI_TOOL_SPECS

logger = logging.getLogger(__name__)

MODEL = "subconscious/tim-qwen3.6-27b"
MAX_STEPS = 12


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


def _build_system_prompt(image_path: str) -> str:
    """Return the system prompt with the working image path embedded."""
    return (
        "You are an image editing assistant. "
        "Use the provided tools to edit the image. "
        f"The image to edit is at: {image_path}\n\n"
        "Pass that exact path as the 'image_path' argument to every tool call. "
        "Chain as many tool calls as needed, then stop when all edits are done — "
        "your final reply (with no tool calls) should summarise what you did."
    )


# ---------------------------------------------------------------------------
# Tool dispatch
# ---------------------------------------------------------------------------


def _dispatch_tool(name: str, arguments_json: str) -> str:
    """Parse *arguments_json*, call the matching function, return JSON string result.

    Raises ``KeyError`` for unknown tool names.
    Raises ``json.JSONDecodeError`` if arguments are malformed.
    Any exception raised by the tool function propagates to the caller.
    """
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        raise KeyError(
            f"Unknown tool: {name!r}.  Available: {sorted(TOOL_FUNCTIONS)}"
        )

    try:
        kwargs: dict[str, Any] = json.loads(arguments_json)
    except json.JSONDecodeError as exc:
        raise json.JSONDecodeError(
            f"Malformed arguments for tool {name!r}: {exc.msg}",
            exc.doc,
            exc.pos,
        ) from exc

    result: dict[str, Any] = fn(**kwargs)  # type: ignore[operator]
    return json.dumps(result)


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


def run_agent(
    client: openai.OpenAI,
    prompt: str,
    image_path: str,
    max_steps: int = MAX_STEPS,
) -> str:
    """Run the native function-tool loop until a final answer is produced.

    Parameters
    ----------
    client:
        Configured ``openai.OpenAI`` instance pointing at the Subconscious endpoint.
    prompt:
        The user's editing instruction.
    image_path:
        Absolute path to the image file passed to every tool call.
    max_steps:
        Maximum number of model → tool → observe iterations before giving up.

    Returns
    -------
    str
        The agent's final answer text.
    """
    system = _build_system_prompt(image_path)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]

    for step in range(1, max_steps + 1):
        logger.info("Agent step %d/%d", step, max_steps)

        completion = client.chat.completions.create(
            model=MODEL,
            messages=messages,  # type: ignore[arg-type]
            tools=OPENAI_TOOL_SPECS,  # type: ignore[arg-type]
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

        msg = completion.choices[0].message
        logger.debug("finish_reason=%s tool_calls=%s", completion.choices[0].finish_reason, bool(msg.tool_calls))

        # No tool calls → model produced the final answer.
        if not msg.tool_calls:
            final_answer: str = msg.content or ""
            logger.info("Agent produced final answer after %d step(s)", step)
            return final_answer

        # --- Tool-call branch ---
        # Append the assistant message (must include tool_calls for history coherence).
        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ],
        }
        messages = [*messages, assistant_message]

        # Execute every tool call and collect result messages.
        tool_result_messages: list[dict[str, Any]] = []
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            logger.debug("Tool call: %s  raw_args=%s", tool_name, tc.function.arguments[:200])
            print(f"  [tool] {tool_name}({tc.function.arguments})")

            try:
                result_json = _dispatch_tool(tool_name, tc.function.arguments)
                logger.debug("Tool result: %s", result_json)
                print(f"  [result] {result_json}")
            except Exception as exc:
                result_json = json.dumps({"status": "error", "message": str(exc)})
                logger.warning("Tool %r raised: %s", tool_name, exc)
                print(f"  [error] {tool_name}: {exc}")

            tool_result_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_json,
                }
            )

        messages = [*messages, *tool_result_messages]

    raise RuntimeError(
        f"Agent exceeded {max_steps} steps without producing a final answer."
    )
