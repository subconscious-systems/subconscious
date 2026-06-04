"""FastAPI server: Subconscious agent with Composio tools (client-side loop).

Architecture
------------
- The ``/run`` endpoint receives a user request, fetches the available Composio
  tool schemas for that user, then runs a client-side ReAct loop using the
  Subconscious OpenAI-compatible API.  All tool calls are executed in this
  process via the Composio SDK — no server-side MCP or tools are used.
- The ``/connections/*`` and ``/connect/*`` endpoints delegate directly to
  Composio for OAuth connection management (unchanged from the original).

Environment variables (required)
---------------------------------
SUBCONSCIOUS_API_KEY  — from subconscious.dev/platform
COMPOSIO_API_KEY      — from platform.composio.dev/settings
"""

from __future__ import annotations

import logging
import os
from typing import Any

import dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

from agent import run_agent
from composio_adapter import get_composio

dotenv.load_dotenv()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------

_SUBCONSCIOUS_API_KEY: str = os.environ.get("SUBCONSCIOUS_API_KEY", "")
_COMPOSIO_API_KEY: str = os.environ.get("COMPOSIO_API_KEY", "")

if not _SUBCONSCIOUS_API_KEY:
    raise RuntimeError(
        "SUBCONSCIOUS_API_KEY environment variable is not set. "
        "Get your key at https://subconscious.dev/platform"
    )
if not _COMPOSIO_API_KEY:
    raise RuntimeError(
        "COMPOSIO_API_KEY environment variable is not set. "
        "Get your key at https://platform.composio.dev/settings"
    )

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Subconscious + Composio",
    description=(
        "AI agent with OAuth access to 1000+ apps via Composio, powered by "
        "Subconscious (client-side tool loop)"
    ),
)


# ── Run ──────────────────────────────────────────────────────────────────────


class RunRequest(BaseModel):
    user_id: str
    instructions: str
    toolkits: list[str] | None = None
    """Optional list of Composio toolkit slugs (e.g. ['github', 'gmail']).

    When omitted the agent searches for relevant tools based on the
    instructions text.
    """

    @field_validator("user_id")
    @classmethod
    def user_id_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("user_id must not be empty")
        return v

    @field_validator("instructions")
    @classmethod
    def instructions_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("instructions must not be empty")
        return v


@app.post("/run")
def run_agent_endpoint(request: RunRequest) -> dict[str, Any]:
    """Kick off a Subconscious agent run with Composio tools (client-side loop)."""
    logger.info(
        "run_agent request: user_id=%s toolkits=%s",
        request.user_id,
        request.toolkits,
    )
    try:
        answer = run_agent(
            user_id=request.user_id,
            instructions=request.instructions,
            api_key=_SUBCONSCIOUS_API_KEY,
            toolkits=request.toolkits,
        )
    except RuntimeError as exc:
        logger.error("Agent run failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"result": answer}


# ── Connections ──────────────────────────────────────────────────────────────


@app.get("/connections/{user_id}")
def list_connections(user_id: str) -> list[dict[str, Any]]:
    """List all toolkits and their connection status for a user."""
    composio = get_composio()
    try:
        connected_accounts = composio.connected_accounts.list(user_uuid=user_id)
    except Exception as exc:
        logger.error("Failed to list connections for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=502, detail=f"Composio API error: {exc}"
        ) from exc

    return [
        {
            "toolkit": account.toolkit_slug if hasattr(account, "toolkit_slug") else str(account),
            "connected": True,
            "account_id": getattr(account, "id", None),
        }
        for account in (connected_accounts.items if hasattr(connected_accounts, "items") else connected_accounts)
    ]


@app.get("/connections/{user_id}/{toolkit}")
def check_connection(user_id: str, toolkit: str) -> dict[str, Any]:
    """Check if a specific toolkit is connected for a user."""
    composio = get_composio()
    try:
        connected_accounts = composio.connected_accounts.list(
            user_uuid=user_id,
            toolkit_slug=toolkit,
        )
    except Exception as exc:
        logger.error(
            "Failed to check connection for user %s / toolkit %s: %s",
            user_id,
            toolkit,
            exc,
        )
        raise HTTPException(
            status_code=502, detail=f"Composio API error: {exc}"
        ) from exc

    items = (
        connected_accounts.items
        if hasattr(connected_accounts, "items")
        else connected_accounts
    )
    connected = len(list(items)) > 0
    return {"toolkit": toolkit, "connected": connected}


# ── Connect ──────────────────────────────────────────────────────────────────


class ConnectRequest(BaseModel):
    user_id: str

    @field_validator("user_id")
    @classmethod
    def user_id_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("user_id must not be empty")
        return v


@app.post("/connect/{toolkit}")
def connect_toolkit(toolkit: str, request: ConnectRequest) -> dict[str, Any]:
    """Start OAuth for a toolkit. Returns a URL to redirect the user to."""
    composio = get_composio()
    try:
        auth_config_list = composio.auth_configs.list(toolkit=toolkit)
        items = (
            auth_config_list.items
            if hasattr(auth_config_list, "items")
            else list(auth_config_list)
        )
        if not items:
            raise HTTPException(
                status_code=404,
                detail=f"No auth config found for toolkit '{toolkit}'.",
            )
        auth_config = items[0]
        connection_request = composio.connected_accounts.initiate(
            auth_config_id=auth_config.id,
            user_uuid=request.user_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Failed to initiate OAuth for toolkit %s / user %s: %s",
            toolkit,
            request.user_id,
            exc,
        )
        raise HTTPException(
            status_code=502, detail=f"Composio API error: {exc}"
        ) from exc

    return {
        "redirect_url": getattr(connection_request, "redirect_url", None)
        or getattr(connection_request, "redirectUrl", None),
    }
