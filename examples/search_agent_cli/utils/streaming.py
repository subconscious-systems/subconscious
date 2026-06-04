"""Display utilities for live agent-loop events."""

from __future__ import annotations

from typing import Optional

from rich.console import Console
from rich.status import Status

from utils.agent import AgentEvent

console = Console()


class DisplayState:
    """Tracks what has already been printed to avoid duplicates."""

    def __init__(self) -> None:
        self.spinner: Optional[Status] = None
        self.spinner_stopped: bool = False
        self.answer_started: bool = False

    def stop_spinner(self) -> None:
        """Stop the loading spinner if it is running."""
        if self.spinner and not self.spinner_stopped:
            self.spinner.stop()
            self.spinner_stopped = True


def start_loading_spinner(state: DisplayState) -> None:
    """Start a 'thinking' spinner and attach it to state."""
    status = Status("[dim]Searching the web...[/dim]", console=console)
    status.start()
    state.spinner = status


def handle_agent_event(event: AgentEvent, state: DisplayState) -> bool:
    """
    React to an AgentEvent by printing appropriate output.

    Args:
        event: The AgentEvent emitted by the agent loop.
        state: Current display state.

    Returns:
        True to continue; False when the loop should stop.
    """
    if event.kind == "thinking":
        # No-op: spinner is already running or was already stopped.
        return True

    if event.kind == "tool_call":
        state.stop_spinner()
        query = (event.args or {}).get("query", "")
        console.print(f"[dim]Searching: {query}[/dim]")
        return True

    if event.kind == "tool_result":
        # Results fed back silently to the model; no need to echo all text.
        return True

    if event.kind == "tool_error":
        state.stop_spinner()
        console.print(f"[yellow]Tool error ({event.tool}): {event.error}[/yellow]")
        return True

    if event.kind == "final":
        state.stop_spinner()
        if not state.answer_started:
            console.print("\n[bold]Answer:[/bold]\n")
            state.answer_started = True
        content = event.content or ""
        print(content, flush=True)
        console.print("\n[bold green]Complete[/bold green]")
        return False

    if event.kind == "error":
        state.stop_spinner()
        console.print(f"\n[bold red]Error:[/bold red] {event.error}")
        return False

    # Unknown event kind — continue.
    return True
