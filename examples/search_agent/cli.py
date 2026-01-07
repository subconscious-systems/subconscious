#!/usr/bin/env python3
"""Main CLI application."""

import os
import sys
from pathlib import Path

import typer
from dotenv import load_dotenv
from subconscious import Subconscious

from utils.errors import handle_error
from utils.streaming import StreamState, handle_stream_event
from utils.timeout import (
    handle_keyboard_interrupt,
    handle_timeout_error,
    reset_timeout,
    timeout_context,
    TimeoutError,
)

# Load environment variables from .env file
load_dotenv()

# Add current directory to path so we can import modules directly
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Create main app
app = typer.Typer(
    name="getting-started-search-agent",
    help="A CLI demonstrating Subconscious's AI agents for deep web research",
    add_completion=False,
)


def stream(question: str, timeout: int = 60) -> None:
    """
    Stream search results in real-time as text deltas arrive.

    Args:
        question: The question to answer
        timeout: Timeout in seconds (default: 60)
    """
    try:
        # Get API key from environment
        api_key = os.getenv("SUBCONSCIOUS_API_KEY")
        if not api_key:
            handle_error(
                ValueError(
                    "API key not found. Set SUBCONSCIOUS_API_KEY environment variable "
                    "or add it to a .env file. Get your key at https://www.subconscious.dev/platform"
                ),
                "Configuration error",
            )

        # Initialize client and prepare request
        client = Subconscious(api_key=api_key)

        # Add terminal-readable formatting instructions
        terminal_prompt = (
            "IMPORTANT: Format your response for terminal/command-line display. "
            "Use plain text only - no LaTeX, no markdown formatting, no special characters. "
            "Use simple line breaks and standard ASCII characters. "
            "Ensure the output is readable in a terminal environment."
        )

        enhanced_question = f"{question}\n\n{terminal_prompt}"

        input_dict = {
            "instructions": enhanced_question,
            "tools": [
                {
                    "type": "platform",
                    "id": "exa_search",
                    "options": {},
                }
            ],
        }

        # Stream and process events with timeout
        state = StreamState()

        try:
            with timeout_context(timeout):
                for event in client.stream(engine="tim-large", input=input_dict):
                    reset_timeout(timeout)
                    if not handle_stream_event(event, state):
                        break
        except TimeoutError as timeout_err:
            handle_timeout_error(timeout_err, state)
            return
        except KeyboardInterrupt:
            handle_keyboard_interrupt()
            raise
        except Exception as stream_error:
            handle_error(stream_error, "Error during streaming")

    except Exception as e:
        handle_error(e, "Streaming failed")


@app.command()
def main(
    question: str = typer.Argument(..., help="The question to answer"),
    timeout: int = typer.Option(
        60,
        "--timeout",
        "-t",
        help="Timeout in seconds (default: 60)",
    ),
) -> None:
    """
    Getting Started Search Agent

    A command-line interface demonstrating Subconscious's AI agents for performing
    deep web research with tool-calling and reasoning visualization.

    Get your API key at: https://www.subconscious.dev/platform

    Usage:
        python cli.py "Your question here"
        python cli.py "Your question here" --timeout 60
    """
    stream(question, timeout=timeout)


if __name__ == "__main__":
    app()
