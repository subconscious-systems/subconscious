"""Error handling utilities."""

import sys
from typing import Optional

from rich.console import Console
from rich.panel import Panel

from subconscious import (
    AuthenticationError,
    RateLimitError,
    SubconsciousError,
)

console = Console(stderr=True)


def handle_error(error: Exception, context: Optional[str] = None) -> None:
    """
    Handle and display errors in a user-friendly way.
    
    Args:
        error: The exception that occurred
        context: Optional context about where the error occurred
    """
    if isinstance(error, AuthenticationError):
        console.print(
            Panel(
                "[bold red]Authentication Error[/bold red]\n\n"
                "Your API key is invalid or missing.\n\n"
                "To fix this:\n"
                "1. Get your API key from https://www.subconscious.dev/platform\n"
                "2. Set it as an environment variable: export SUBCONSCIOUS_API_KEY='your-key'\n"
                "3. Or pass it via --api-key flag",
                title="Error",
                border_style="red",
            )
        )
        sys.exit(1)
    elif isinstance(error, RateLimitError):
        console.print(
            Panel(
                "[bold yellow]Rate Limit Exceeded[/bold yellow]\n\n"
                "You've exceeded the API rate limit. Please:\n"
                "1. Wait a few moments before retrying\n"
                "2. Check your usage limits at https://www.subconscious.dev/platform\n"
                "3. Consider upgrading your plan if needed",
                title="Rate Limit",
                border_style="yellow",
            )
        )
        sys.exit(1)
    elif isinstance(error, SubconsciousError):
        console.print(
            Panel(
                f"[bold red]API Error[/bold red]\n\n"
                f"Code: {error.code}\n"
                f"Message: {error}\n"
                f"Status: {error.status}",
                title="Error",
                border_style="red",
            )
        )
        sys.exit(1)
    elif isinstance(error, KeyboardInterrupt):
        console.print("\n[yellow]Operation cancelled by user[/yellow]")
        sys.exit(130)
    else:
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

