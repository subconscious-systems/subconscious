"""Browser tools — thin, validated wrappers over a live Playwright ``Page``.

Each tool returns a JSON-serialisable dict: ``{"status": "success", ...}`` or
``{"status": "error", "message": "..."}``. Actions that change the page append a
compact ``snapshot`` (url + title + a text excerpt) so the model can *see* the
result of what it just did — that observation is what keeps the agent on track.

``build_tools(page)`` binds the tools to one page and returns the OpenAI function
specs plus a name -> callable map. We never mutate shared state; results are
always freshly built dicts.
"""

from collections.abc import Callable
from typing import Any

from playwright.sync_api import Page

# Keep page-text observations small so we don't blow the context window.
MAX_TEXT_CHARS = 3000
MAX_LINKS = 40


def _snapshot(page: Page, *, include_text: bool = True) -> dict[str, Any]:
    """A compact view of the current page for the model to reason over."""
    snap: dict[str, Any] = {"url": page.url, "title": page.title()}
    if include_text:
        try:
            text = page.inner_text("body")
        except Exception:
            text = ""
        snap["text_excerpt"] = text.strip()[:MAX_TEXT_CHARS]
    return snap


def _navigate(page: Page, url: str) -> dict[str, Any]:
    """Load a URL and wait for the DOM to settle."""
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    return {"status": "success", "snapshot": _snapshot(page)}


def _click(page: Page, text: str | None = None, selector: str | None = None) -> dict[str, Any]:
    """Click an element by visible text or by CSS selector (one is required)."""
    if selector:
        locator = page.locator(selector)
    elif text:
        locator = page.get_by_text(text, exact=False)
    else:
        return {"status": "error", "message": "provide either 'text' or 'selector'"}
    locator.first.click(timeout=15_000)
    page.wait_for_load_state("domcontentloaded", timeout=15_000)
    return {"status": "success", "snapshot": _snapshot(page)}


def _type_text(
    page: Page,
    text: str,
    selector: str | None = None,
    submit: bool = False,
) -> dict[str, Any]:
    """Type into an input. Without a selector, target the first visible textbox.
    Set ``submit`` to press Enter afterwards (e.g. to run a search)."""
    target = (
        page.locator(selector)
        if selector
        else page.locator("input:visible, textarea:visible").first
    )
    target.fill(text, timeout=15_000)
    if submit:
        target.press("Enter")
        page.wait_for_load_state("domcontentloaded", timeout=15_000)
    return {"status": "success", "snapshot": _snapshot(page)}


def _read_page(page: Page) -> dict[str, Any]:
    """Return the visible text of the current page (truncated)."""
    return {"status": "success", "snapshot": _snapshot(page)}


def _list_links(page: Page) -> dict[str, Any]:
    """List the page's links as ``{text, href}`` so the model can pick a target."""
    anchors = page.eval_on_selector_all(
        "a[href]",
        "els => els.map(e => ({ text: (e.innerText || '').trim(), href: e.href }))",
    )
    links = [a for a in anchors if a["text"]][:MAX_LINKS]
    return {"status": "success", "count": len(links), "links": links}


def _screenshot(page: Page, path: str) -> dict[str, Any]:
    """Save a full-page screenshot to ``path`` (under the workspace)."""
    page.screenshot(path=path, full_page=True)
    return {"status": "success", "path": path}


# --- OpenAI function specs ---------------------------------------------------

def _spec(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


OPENAI_TOOL_SPECS: list[dict] = [
    _spec(
        "navigate",
        "Load a web page by URL. Returns the new page's title and visible text.",
        {"url": {"type": "string", "description": "URL to open, e.g. https://example.com"}},
        ["url"],
    ),
    _spec(
        "click",
        "Click an element by its visible text (preferred) or a CSS selector.",
        {
            "text": {"type": "string", "description": "Visible text of the element to click"},
            "selector": {"type": "string", "description": "CSS selector (use if text is ambiguous)"},
        },
        [],
    ),
    _spec(
        "type_text",
        "Type text into an input field, optionally pressing Enter to submit.",
        {
            "text": {"type": "string", "description": "Text to type"},
            "selector": {"type": "string", "description": "CSS selector of the input (optional)"},
            "submit": {"type": "boolean", "description": "Press Enter after typing"},
        },
        ["text"],
    ),
    _spec(
        "read_page",
        "Re-read the current page's URL, title, and visible text. Use this to observe.",
        {},
        [],
    ),
    _spec(
        "list_links",
        "List the links on the current page as {text, href} to find where to go next.",
        {},
        [],
    ),
    _spec(
        "screenshot",
        "Save a full-page screenshot to the workspace.",
        {"path": {"type": "string", "description": "Output file path"}},
        ["path"],
    ),
]


def build_tools(page: Page) -> tuple[list[dict], dict[str, Callable[..., dict]]]:
    """Bind the tools to ``page`` and return (specs, {name: callable})."""
    functions: dict[str, Callable[..., dict]] = {
        "navigate": lambda url: _navigate(page, url),
        "click": lambda text=None, selector=None: _click(page, text, selector),
        "type_text": lambda text, selector=None, submit=False: _type_text(
            page, text, selector, submit
        ),
        "read_page": lambda: _read_page(page),
        "list_links": lambda: _list_links(page),
        "screenshot": lambda path: _screenshot(page, path),
    }
    return OPENAI_TOOL_SPECS, functions
