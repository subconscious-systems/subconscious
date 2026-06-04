"""Subconscious OpenAI-compatible client factory."""

import os

from openai import OpenAI

SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"


def create_client(api_key: str) -> OpenAI:
    """
    Create an OpenAI-compatible client pointed at the Subconscious API.

    Args:
        api_key: Subconscious API key.

    Returns:
        Configured OpenAI client instance.
    """
    return OpenAI(
        api_key=api_key,
        base_url=SUBCONSCIOUS_BASE_URL,
    )


def resolve_api_key() -> str:
    """
    Read the Subconscious API key from the environment.

    Returns:
        The API key string.

    Raises:
        ValueError: If the environment variable is not set.
    """
    api_key = os.environ.get("SUBCONSCIOUS_API_KEY")
    if not api_key:
        raise ValueError(
            "SUBCONSCIOUS_API_KEY environment variable is not set. "
            "Get your key at https://www.subconscious.dev/platform and "
            "run: export SUBCONSCIOUS_API_KEY=your_key"
        )
    return api_key
