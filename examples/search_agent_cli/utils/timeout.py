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
    except TimeoutError:
        if sys.platform != "win32":
            signal.alarm(0)  # Cancel alarm
        elapsed = time.time() - stream_start_time
        raise TimeoutError(
            f"No response received within {timeout} seconds (elapsed: {elapsed:.1f}s)"
        )
    except KeyboardInterrupt:
        if sys.platform != "win32":
            signal.alarm(0)  # Cancel alarm
        raise
    finally:
        # Cancel alarm if still active
        if sys.platform != "win32":
            signal.alarm(0)


def reset_timeout(timeout: int) -> None:
    """
    Reset the timeout alarm (call this on each stream event).
    
    Args:
        timeout: Timeout in seconds
    """
    if sys.platform != "win32":
        signal.alarm(timeout)


def handle_timeout_error(error: TimeoutError, state) -> None:
    """
    Handle and display timeout errors.
    
    Args:
        error: The TimeoutError exception
        state: StreamState object to check for partial responses
    """
    timeout_msg = f"\n[bold yellow]Timeout:[/bold yellow] {error}"
    console.print(timeout_msg)
    if state.displayed_answer:
        console.print("\n[bold green]✓ Partial response received[/bold green]")
    else:
        console.print("\n[yellow]No answer received before timeout[/yellow]")


def handle_keyboard_interrupt() -> None:
    """Handle and display keyboard interrupt message."""
    console.print("\n[yellow]Stream interrupted by user[/yellow]")

