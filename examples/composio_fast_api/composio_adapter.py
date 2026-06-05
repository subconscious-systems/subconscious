"""Composio adapter: fetch tool schemas and execute tools client-side.

This module wraps the Composio SDK so the agent loop never imports Composio
directly — all tool schema translation and execution lives here.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from composio import Composio
from composio.core.provider._openai import OpenAIProvider

logger = logging.getLogger(__name__)

# Shared Composio client (one per process); api_key read from COMPOSIO_API_KEY env var.
_composio: Composio | None = None


def get_composio() -> Composio:
    """Return the process-level Composio client, initialising it on first call."""
    global _composio  # noqa: PLW0603 — intentional module-level singleton
    if _composio is None:
        _composio = Composio(provider=OpenAIProvider())
    return _composio


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------


def fetch_tool_schemas(
    user_id: str,
    *,
    toolkits: list[str] | None = None,
    tools: list[str] | None = None,
    search: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Return a list of OpenAI-style tool dicts for the given user / filter.

    At least one of *toolkits*, *tools*, or *search* must be provided.

    Args:
        user_id: Composio user ID whose connected accounts are used for auth.
        toolkits: Toolkit slug(s) to fetch tools from (e.g. ["github"]).
        tools: Explicit tool slug(s) to fetch.
        search: Free-text search across all available tools.
        limit: Maximum number of tools to return.

    Returns:
        List of ``{"type": "function", "function": {...}}`` dicts compatible
        with the OpenAI Chat Completions ``tools`` parameter format.
    """
    composio = get_composio()
    raw_tools = composio.tools.get(
        user_id,
        tools=tools,
        toolkits=toolkits,
        search=search,
        limit=limit,
    )
    # get() returns list[ChatCompletionToolParam] when using OpenAIProvider.
    # Convert to plain dicts so callers have no openai dependency.
    result: list[dict[str, Any]] = []
    for tool in raw_tools:
        if isinstance(tool, dict):
            result.append(tool)
        else:
            # TypedDict / NamedTuple — serialise via JSON round-trip to get plain dict.
            result.append(json.loads(json.dumps(tool)))
    return result


# ---------------------------------------------------------------------------
# Execution helper
# ---------------------------------------------------------------------------


def execute_tool(
    tool_slug: str,
    arguments: dict[str, Any],
    *,
    user_id: str,
) -> dict[str, Any]:
    """Execute a Composio tool and return its result as a plain dict.

    Args:
        tool_slug: The Composio tool slug (matches the ``function.name`` in the
            schema returned by :func:`fetch_tool_schemas`).
        arguments: Parsed tool arguments from the model's JSON response.
        user_id: Composio user ID; routes to the correct connected account.

    Returns:
        Plain dict containing the tool execution result.

    Raises:
        RuntimeError: If the Composio API returns an error.
    """
    composio = get_composio()
    logger.info("Executing Composio tool %s for user %s", tool_slug, user_id)
    try:
        response = composio.tools.execute(
            slug=tool_slug,
            arguments=arguments,
            user_id=user_id,
        )
    except Exception as exc:
        logger.error(
            "Composio tool execution failed: tool=%s user=%s error=%s",
            tool_slug,
            user_id,
            exc,
        )
        raise RuntimeError(f"Composio tool '{tool_slug}' failed: {exc}") from exc

    # ToolExecutionResponse is a Pydantic model — serialise to plain dict.
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return dict(response)  # type: ignore[call-overload]
