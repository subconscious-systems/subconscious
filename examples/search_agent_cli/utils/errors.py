"""Error handling utilities."""

import sys
from typing import Optional

from openai import APIStatusError, AuthenticationError, RateLimitError
from rich.console import Console
from rich.panel import Panel

console = Console(stderr=True)


def handle_error(error: Exception, context: Optional[str] = None) -> None:
    """
    Display an error in a user-friendly panel and exit with a non-zero status.

    Args:
        error: The exception that occurred.
        context: Optional human-readable context for where the error happened.
    """
    if isinstance(error, AuthenticationError):
        console.print(
            Panel(
                "[bold red]Authentication Error[/bold red]\n\n"
                "Your API key is invalid or missing.\n\n"
                "To fix this:\n"
                "1. Get your API key from https://www.subconscious.dev/platform\n"
                "2. Set it as an environment variable: "
                "export SUBCONSCIOUS_API_KEY=your_key",
                title="Error",
                border_style="red",
            )
        )
        sys.exit(1)

    if isinstance(error, RateLimitError):
        console.print(
            Panel(
                "[bold yellow]Rate Limit Exceeded[/bold yellow]\n\n"
                "You have exceeded the API rate limit. Please:\n"
                "1. Wait a moment before retrying\n"
                "2. Check your usage at https://www.subconscious.dev/platform",
                title="Rate Limit",
                border_style="yellow",
            )
        )
        sys.exit(1)

    if isinstance(error, APIStatusError):
        console.print(
            Panel(
                f"[bold red]API Error[/bold red]\n\n"
                f"Status: {error.status_code}\n"
                f"Message: {error.message}",
                title="Error",
                border_style="red",
            )
        )
        sys.exit(1)

    if isinstance(error, KeyboardInterrupt):
        console.print("\n[yellow]Operation cancelled by user[/yellow]")
        sys.exit(130)

    error_msg = str(error)
    if context:
        error_msg = f"{context}: {error_msg}"

    console.print(
        Panel(
            f"[bold red]Unexpected Error[/bold red]\n\n{error_msg}",
            title="Error",
            border_style="red",
        )
    )
    sys.exit(1)
