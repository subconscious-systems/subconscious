"""Streaming utilities for processing and displaying streamed responses."""

import json
import re
from typing import Optional, Set

from rich.console import Console
from rich.status import Status

console = Console()


class StreamState:
    """Tracks state during streaming."""

    def __init__(self):
        self.full_content = ""
        self.displayed_answer = ""
        self.displayed_thoughts: Set[str] = set()
        self.answer_started = False
        self.first_content_received = False
        self.spinner: Optional[Status] = None


def extract_thoughts_from_json(json_str: str) -> list[str]:
    """
    Extract thought strings from incomplete JSON using regex.

    This allows us to extract thoughts as the JSON is being streamed,
    even before the JSON is complete.
    """
    thoughts = []
    # Pattern to match "thought": "..." with escaped quotes handled
    pattern = r'"thought"\s*:\s*"((?:[^"\\]|\\.)*)"'
    matches = re.finditer(pattern, json_str)
    for match in matches:
        thought = match.group(1)
        # Decode Unicode escape sequences (e.g., \u201c -> " and \u201d -> ")
        thought = re.sub(
            r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), thought
        )
        # Unescape JSON string - handle common escape sequences
        thought = (
            thought.replace('\\"', '"')
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\r", "\r")
            .replace("\\\\", "\\")
        )
        # Only add non-empty thoughts
        if thought.strip():
            thoughts.append(thought)
    return thoughts


def display_thoughts(state: StreamState) -> None:
    """Extract and display new thoughts from the streamed content."""
    thoughts = extract_thoughts_from_json(state.full_content)
    for thought in thoughts:
        # Use first 100 chars as identifier to avoid duplicates
        thought_id = thought[:100] if len(thought) > 100 else thought
        if thought_id not in state.displayed_thoughts and thought.strip():
            state.displayed_thoughts.add(thought_id)
            # Stop spinner when first thought appears
            if not state.first_content_received and state.spinner:
                state.spinner.stop()
                state.first_content_received = True
            console.print(f"[dim]💭 {thought}[/dim]")


def extract_answer_from_json(content: str) -> str:
    """Extract answer field from JSON content."""
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict) and "answer" in parsed:
            return parsed.get("answer", "")
    except (json.JSONDecodeError, ValueError, KeyError):
        pass
    return ""


def display_answer_delta(state: StreamState) -> None:
    """Display new answer content as it streams in."""
    answer_text = extract_answer_from_json(state.full_content)
    if not answer_text:
        return

    # Stop spinner when first answer content appears
    if not state.first_content_received and state.spinner:
        state.spinner.stop()
        state.first_content_received = True

    # Print header when answer first appears
    if not state.answer_started:
        console.print("\n[bold]Answer:[/bold]\n")
        state.answer_started = True

    # Only print the new part of the answer that we haven't displayed yet
    if len(answer_text) > len(state.displayed_answer):
        new_text = answer_text[len(state.displayed_answer) :]
        print(new_text, end="", flush=True)
        state.displayed_answer = answer_text


def display_final_answer(state: StreamState) -> None:
    """Display the final answer if it hasn't been displayed yet."""
    if state.displayed_answer:
        return

    if not state.full_content.strip():
        return

    # Try to extract answer from complete JSON
    answer_text = extract_answer_from_json(state.full_content)
    if answer_text:
        if not state.answer_started:
            console.print("\n[bold]Answer:[/bold]\n")
            state.answer_started = True
        print(answer_text, end="", flush=True)
        state.displayed_answer = answer_text
    else:
        # If parsing fails, display content as-is
        if not state.answer_started:
            console.print("\n[bold]Answer:[/bold]\n")
            state.answer_started = True
        print(state.full_content, end="", flush=True)
        state.displayed_answer = state.full_content


def start_loading_spinner(state: StreamState) -> None:
    """Start a loading spinner while waiting for the first streamed content."""
    status = Status("[dim]Asking the model...[/dim]", console=console)
    status.start()
    state.spinner = status


def stop_loading_spinner(state: StreamState) -> None:
    """Stop the loading spinner if it's still running."""
    if state.spinner and not state.first_content_received:
        state.spinner.stop()
        state.first_content_received = True


def handle_stream_event(event, state: StreamState) -> bool:
    """
    Handle a single stream event.

    Returns:
        True if streaming should continue, False if it should stop
    """
    event_type = event.type

    if event_type == "delta":
        content = event.content
        if content:
            state.full_content += content
            display_thoughts(state)
            display_answer_delta(state)
        return True

    elif event_type == "done":
        stop_loading_spinner(state)
        display_final_answer(state)
        console.print("\n\n[bold green]✓ Complete[/bold green]")
        return False

    elif event_type == "error":
        stop_loading_spinner(state)
        console.print(f"\n[bold red]Error:[/bold red] {event.message}")
        if event.code:
            console.print(f"[dim]Error code: {event.code}[/dim]")
        return False

    # Unknown event type - continue
    return True
