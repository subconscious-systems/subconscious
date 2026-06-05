"""Client-side native function-tool loop for the Subconscious + Composio agent.

Subconscious exposes an OpenAI-compatible chat endpoint that supports standard
OpenAI function tools (``tools=[...]`` parameter).  The Composio SDK, when
initialised with ``OpenAIProvider``, already returns tool schemas in the exact
``{"type":"function","function":{name,description,parameters}}`` shape required,
so we feed them straight to the API — no JSON-schema workaround needed.

Loop:
1. POST messages + Composio tool schemas to Subconscious.
2. If the response has ``tool_calls``, append the assistant message (with
   ``tool_calls``), execute each call via the Composio SDK, and append a
   ``role: "tool"`` result message for each call.  Repeat.
3. When a response has no ``tool_calls``, ``message.content`` is the final answer.
4. A ``max_steps`` guard prevents infinite loops.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import openai

from composio_adapter import execute_tool, fetch_tool_schemas

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"
DEFAULT_MAX_STEPS = 12

_SYSTEM_PROMPT = (
    "You are a helpful AI assistant with access to Composio tools. "
    "Use the available tools to complete the user's request. "
    "When you have enough information to answer, respond directly without calling any tool."
)


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------


def run_agent(
    *,
    user_id: str,
    instructions: str,
    api_key: str,
    toolkits: list[str] | None = None,
    max_steps: int = DEFAULT_MAX_STEPS,
) -> str:
    """Run one user turn to completion using native OpenAI function tools.

    Args:
        user_id: Composio user ID — used to look up connected accounts and to
            execute tools on behalf of the user.
        instructions: The user's natural-language request.
        api_key: Subconscious API key.
        toolkits: Optional list of Composio toolkit slugs to restrict the
            available tools (e.g. ``["github", "gmail"]``).  When *None* the
            agent falls back to a keyword search based on the user instructions.
        max_steps: Maximum number of model calls before we give up.

    Returns:
        The final answer text from the model.

    Raises:
        RuntimeError: If the model exceeds ``max_steps`` without a final answer.
        openai.OpenAIError: If the Subconscious API returns an error.
    """
    # --- Fetch Composio tool schemas (already in OpenAI format) ---------------
    tools = _fetch_schemas_for_request(
        user_id=user_id,
        instructions=instructions,
        toolkits=toolkits,
    )

    logger.info(
        "Agent starting: user_id=%s tools=%d max_steps=%d",
        user_id,
        len(tools),
        max_steps,
    )

    # --- Build initial messages -----------------------------------------------
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": instructions},
    ]

    # --- OpenAI client pointed at Subconscious --------------------------------
    client = openai.OpenAI(
        api_key=api_key,
        base_url=SUBCONSCIOUS_BASE_URL,
    )

    # --- Native tool loop -----------------------------------------------------
    for step in range(max_steps):
        logger.debug("Agent step %d/%d", step + 1, max_steps)

        completion = client.chat.completions.create(
            model=MODEL,
            messages=messages,  # type: ignore[arg-type]
            tools=tools,  # type: ignore[arg-type]
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

        msg = completion.choices[0].message

        # No tool calls → this is the final answer.
        if not msg.tool_calls:
            logger.info("Agent produced final answer after %d step(s)", step + 1)
            return msg.content or ""

        # --- Append the assistant turn (must include tool_calls) --------------
        messages = [
            *messages,
            {
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
            },
        ]

        # --- Execute each tool call and append results ------------------------
        tool_result_messages: list[dict[str, Any]] = []
        for tc in msg.tool_calls:
            tool_result_messages.append(
                _execute_tool_call(tc=tc, user_id=user_id)
            )

        messages = [*messages, *tool_result_messages]

    raise RuntimeError(
        f"Agent exceeded max_steps ({max_steps}) without reaching a final answer."
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _fetch_schemas_for_request(
    *,
    user_id: str,
    instructions: str,
    toolkits: list[str] | None,
) -> list[dict[str, Any]]:
    """Fetch Composio tool schemas, using toolkit filter or keyword search."""
    if toolkits:
        return fetch_tool_schemas(user_id, toolkits=toolkits, limit=30)
    # Fall back to keyword search so the agent always has *some* tools.
    # Limit tightly to keep context manageable.
    return fetch_tool_schemas(user_id, search=instructions[:80], limit=15)


def _execute_tool_call(
    *,
    tc: Any,
    user_id: str,
) -> dict[str, Any]:
    """Execute a single tool call and return the ``role: "tool"`` message dict.

    Args:
        tc: A tool-call object with ``.id``, ``.function.name``, and
            ``.function.arguments`` (JSON-encoded string).
        user_id: Composio user ID for routing to the correct connected account.

    Returns:
        A message dict with ``role="tool"``, ``tool_call_id``, and ``content``.
    """
    tool_name: str = tc.function.name

    try:
        arguments: dict[str, Any] = json.loads(tc.function.arguments)
    except json.JSONDecodeError as exc:
        logger.error(
            "Malformed JSON in tool arguments: tool=%s args=%r error=%s",
            tool_name,
            tc.function.arguments,
            exc,
        )
        return {
            "role": "tool",
            "tool_call_id": tc.id,
            "content": json.dumps({"error": f"Malformed tool arguments: {exc}"}),
        }

    logger.info("Executing tool %s with args: %s", tool_name, arguments)

    try:
        result = execute_tool(
            tool_slug=tool_name,
            arguments=arguments,
            user_id=user_id,
        )
        content = json.dumps(result, default=str)
    except RuntimeError as exc:
        logger.error("Tool %s failed: %s", tool_name, exc)
        content = json.dumps({"error": str(exc)})

    return {
        "role": "tool",
        "tool_call_id": tc.id,
        "content": content,
    }
