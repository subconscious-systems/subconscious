#!/usr/bin/env python3
"""Main CLI application."""

import sys
from pathlib import Path

import typer
from dotenv import load_dotenv

from utils.agent import run_agent
from utils.client import create_client, resolve_api_key
from utils.errors import handle_error
from utils.streaming import DisplayState, handle_agent_event, start_loading_spinner
from utils.timeout import (
    TimeoutError,
    handle_keyboard_interrupt,
    handle_timeout_error,
    reset_timeout,
    timeout_context,
)

# Load environment variables from an optional .env file.
load_dotenv()

# Make the package importable when run directly via `python cli.py`.
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Default timeout in seconds.
DEFAULT_TIMEOUT = 300

app = typer.Typer(
    name="search-agent-cli",
    help="A CLI that answers research questions using a client-side ReAct search loop.",
    add_completion=False,
)


def run_search(question: str, timeout: int = DEFAULT_TIMEOUT) -> None:
    """
    Run the ReAct search agent and stream live progress to the terminal.

    Args:
        question: The research question to answer.
        timeout: Wall-clock timeout in seconds (default: DEFAULT_TIMEOUT).
    """
    try:
        api_key = resolve_api_key()
    except ValueError as exc:
        handle_error(exc, "Configuration error")
        return  # handle_error calls sys.exit, but satisfy type-checker

    client = create_client(api_key)
    state = DisplayState()
    start_loading_spinner(state)

    def on_event(event):
        """Forward agent events to the display handler."""
        handle_agent_event(event, state)

    try:
        with timeout_context(timeout):
            run_agent(
                client=client,
                question=question,
                on_event=on_event,
            )
            reset_timeout(timeout)
    except TimeoutError as exc:
        state.stop_spinner()
        handle_timeout_error(exc, state)
    except KeyboardInterrupt:
        state.stop_spinner()
        handle_keyboard_interrupt()
        raise
    except Exception as exc:
        state.stop_spinner()
        handle_error(exc, "Agent error")


@app.command()
def main(
    question: str = typer.Argument(..., help="The research question to answer"),
    timeout: int = typer.Option(
        DEFAULT_TIMEOUT,
        "--timeout",
        "-t",
        help=f"Timeout in seconds (default: {DEFAULT_TIMEOUT})",
    ),
) -> None:
    """
    Search Agent CLI

    Answer research questions using a client-side ReAct loop:
    the model decides when to call web_search (DuckDuckGo), sees the results,
    and loops until it has enough information to give a final answer.

    Get your API key at: https://www.subconscious.dev/platform

    Usage:
        python cli.py "Your question here"
        python cli.py "Your question here" --timeout 180
    """
    run_search(question, timeout=timeout)


if __name__ == "__main__":
    app()
