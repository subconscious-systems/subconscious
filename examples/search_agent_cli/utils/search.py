"""Client-side web_search tool using DuckDuckGo (ddgs)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from ddgs import DDGS

MAX_RESULTS = 8


@dataclass(frozen=True)
class SearchResult:
    """A single search result."""

    title: str
    href: str
    body: str


def web_search(query: str, max_results: int = MAX_RESULTS) -> List[SearchResult]:
    """
    Search the web using DuckDuckGo and return structured results.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return (default: 8).

    Returns:
        A list of SearchResult objects (may be empty if no results found).

    Raises:
        ValueError: If query is empty.
        RuntimeError: If the search fails due to a network or API error.
    """
    if not query or not query.strip():
        raise ValueError("Search query must not be empty.")

    try:
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query.strip(), max_results=max_results))
    except Exception as exc:
        raise RuntimeError(f"DuckDuckGo search failed: {exc}") from exc

    return [
        SearchResult(
            title=r.get("title", ""),
            href=r.get("href", ""),
            body=r.get("body", ""),
        )
        for r in raw_results
    ]


def format_search_results(results: List[SearchResult]) -> str:
    """
    Format a list of SearchResult objects into a plain-text summary.

    Args:
        results: Search results to format.

    Returns:
        Formatted string suitable for feeding back into the model context.
    """
    if not results:
        return "No results found."

    lines: List[str] = []
    for i, r in enumerate(results, start=1):
        lines.append(f"[{i}] {r.title}")
        lines.append(f"    URL: {r.href}")
        lines.append(f"    {r.body}")
        lines.append("")

    return "\n".join(lines).rstrip()
