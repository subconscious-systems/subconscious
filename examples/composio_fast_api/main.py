from composio import Composio
from subconscious import Subconscious
from fastapi import FastAPI
from pydantic import BaseModel
import os
import dotenv

dotenv.load_dotenv()

composio = Composio()
sub_client = Subconscious(api_key=os.getenv("SUBCONSCIOUS_API_KEY"))

app = FastAPI(
    title="Subconscious + Composio",
    description="AI agent with OAuth access to 1000+ apps via Composio, powered by Subconscious",
)


def build_mcp_tool(session):
    """Convert a Composio MCP session into a Subconscious MCP tool dict."""
    mcp_url = session.mcp.url
    mcp_headers = session.mcp.headers

    tool: dict = {"type": "mcp", "url": mcp_url}

    if mcp_headers:
        auth_value = mcp_headers.get("Authorization", "")
        if auth_value.startswith("Bearer "):
            tool["auth"] = {"type": "bearer", "token": auth_value[len("Bearer "):]}
        else:
            for header_name, header_value in mcp_headers.items():
                if header_name.lower() not in ("content-type",):
                    tool["auth"] = {
                        "type": "api_key",
                        "token": header_value,
                        "header": header_name,
                    }
                    break

    return tool


# ── Run ──────────────────────────────────────────────────────────────────────


class RunRequest(BaseModel):
    user_id: str
    instructions: str


@app.post("/run")
def run_agent(request: RunRequest):
    """Kick off a Subconscious agent run with Composio tools."""
    session = composio.create(user_id=request.user_id)
    mcp_tool = build_mcp_tool(session)

    run = sub_client.run(
        engine="tim",
        input={
            "instructions": request.instructions,
            "tools": [mcp_tool],
        },
        options={"await_completion": True},
    )

    return {"result": run.result.answer}


# ── Connections ──────────────────────────────────────────────────────────────


@app.get("/connections/{user_id}")
def list_connections(user_id: str):
    """List all toolkits and their connection status for a user."""
    session = composio.create(user_id=user_id)
    toolkits = session.toolkits()
    return [
        {
            "toolkit": t.slug,
            "connected": t.connection.is_active if t.connection else False,
        }
        for t in toolkits.items
    ]


@app.get("/connections/{user_id}/{toolkit}")
def check_connection(user_id: str, toolkit: str):
    """Check if a specific toolkit is connected for a user."""
    session = composio.create(user_id=user_id, toolkits=[toolkit])
    toolkits = session.toolkits()
    for t in toolkits.items:
        if t.slug == toolkit:
            return {
                "toolkit": toolkit,
                "connected": t.connection.is_active if t.connection else False,
            }
    return {"toolkit": toolkit, "connected": False}


# ── Connect ──────────────────────────────────────────────────────────────────


class ConnectRequest(BaseModel):
    user_id: str


@app.post("/connect/{toolkit}")
def connect_toolkit(toolkit: str, request: ConnectRequest):
    """Start OAuth for a toolkit. Returns a URL to redirect the user to."""
    session = composio.create(user_id=request.user_id, toolkits=[toolkit])
    connection_request = session.authorize(toolkit)
    return {"redirect_url": connection_request.redirect_url}
