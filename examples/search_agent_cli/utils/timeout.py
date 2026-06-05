"""Timeout utilities for streaming operations."""

import signal
import sys
import time
from contextlib import contextmanager
from typing import Generator

from rich.console import Console

console = Console()


class TimeoutError(Exception):
    """Custom timeout exception."""

    pass


def timeout_handler(signum, frame):
    """Signal handler for timeout."""
    raise TimeoutError("Stream timeout: No response received within the timeout period")


@contextmanager
def timeout_context(timeout: int) -> Generator[None, None, None]:
    """
    Context manager for handling timeouts during streaming.
    
    Args:
        timeout: Timeout in seconds
        
    Yields:
        None
    """
    stream_start_time = time.time()
    
    # Set up timeout signal (Unix only)
    if sys.platform != "win32":
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(timeout)
    
    try:
        yield
    except TimeoutError as exc:
        if sys.platform != "win32":
            signal.alarm(0)  # Cancel alarm
        elapsed = time.time() - stream_start_time
        raise TimeoutError(
            f"No response received within {timeout} seconds (elapsed: {elapsed:.1f}s)"
        ) from exc
    except KeyboardInterrupt:
        if sys.platform != "win32":
            signal.alarm(0)  # Cancel alarm
        raise
    finally:
        # Cancel alarm if still active
        if sys.platform != "win32":
            signal.alarm(0)


def handle_timeout_error(error: TimeoutError, state) -> None:
    """
    Handle and display timeout errors.

    Args:
        error: The TimeoutError exception.
        state: DisplayState object used to check whether an answer was started.
    """
    console.print(f"\n[bold yellow]Timeout:[/bold yellow] {error}")
    if getattr(state, "answer_started", False):
        console.print("\n[bold green]Partial response received[/bold green]")
    else:
        console.print("\n[yellow]No answer received before timeout[/yellow]")


def handle_keyboard_interrupt() -> None:
    """Handle and display keyboard interrupt message."""
    console.print("\n[yellow]Stream interrupted by user[/yellow]")

