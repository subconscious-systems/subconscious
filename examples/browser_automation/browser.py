"""Cloud browser providers — Browserbase or Kernel — behind one tiny interface.

Both providers hand back a Chrome DevTools Protocol (CDP) websocket URL, so the
rest of the app talks to a single Playwright ``Page`` and never cares which
backend is live. Pick one with ``BROWSER_PROVIDER=browserbase|kernel`` or just
set the keys for one provider and we'll detect it.

Because we *connect* to a remote browser over CDP (rather than launching one
locally), there is no ``playwright install`` step — ``pip install`` is enough.
"""

import os
from collections.abc import Callable
from dataclasses import dataclass

from browserbase import Browserbase
from kernel import Kernel
from playwright.sync_api import Browser, Page, Playwright, sync_playwright


@dataclass(frozen=True)
class BrowserConnection:
    """Everything we need to drive a remote browser. Immutable by design."""

    cdp_url: str
    provider: str
    live_view_url: str | None = None


def _connect_browserbase() -> BrowserConnection:
    """Create a Browserbase session and return its CDP URL."""
    api_key = os.getenv("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Browserbase needs BROWSERBASE_API_KEY — get one at https://browserbase.com"
        )

    bb = Browserbase(api_key=api_key)
    # project_id is optional — Browserbase infers it from the API key. Pass it
    # only if the user set it (e.g. an account with multiple projects).
    project_id = os.getenv("BROWSERBASE_PROJECT_ID")
    session = bb.sessions.create(project_id=project_id) if project_id else bb.sessions.create()
    return BrowserConnection(
        cdp_url=session.connect_url,
        provider="browserbase",
        live_view_url=f"https://browserbase.com/sessions/{session.id}",
    )


def _connect_kernel() -> BrowserConnection:
    """Create a Kernel browser and return its CDP URL."""
    if not os.getenv("KERNEL_API_KEY"):
        raise RuntimeError(
            "Kernel needs KERNEL_API_KEY — get one at https://onkernel.com"
        )

    client = Kernel()  # reads KERNEL_API_KEY from the environment
    kb = client.browsers.create()
    return BrowserConnection(
        cdp_url=kb.cdp_ws_url,
        provider="kernel",
        live_view_url=getattr(kb, "browser_live_view_url", None),
    )


_PROVIDERS: dict[str, Callable[[], BrowserConnection]] = {
    "browserbase": _connect_browserbase,
    "kernel": _connect_kernel,
}


def detect_provider() -> str:
    """Resolve the backend from BROWSER_PROVIDER, else from whichever keys exist."""
    explicit = os.getenv("BROWSER_PROVIDER")
    if explicit:
        key = explicit.strip().lower()
        if key not in _PROVIDERS:
            raise RuntimeError(
                f"Unknown BROWSER_PROVIDER {explicit!r} — use 'browserbase' or 'kernel'"
            )
        return key
    if os.getenv("BROWSERBASE_API_KEY"):
        return "browserbase"
    if os.getenv("KERNEL_API_KEY"):
        return "kernel"
    raise RuntimeError(
        "No browser backend configured — set BROWSER_PROVIDER and the matching "
        "keys (see .env.example)"
    )


class BrowserSession:
    """Owns the Playwright lifecycle and a single page. Use as a context manager.

        with BrowserSession() as session:
            session.page.goto("https://example.com")
    """

    def __init__(self) -> None:
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self.page: Page | None = None
        self.connection: BrowserConnection | None = None

    def __enter__(self) -> "BrowserSession":
        provider = detect_provider()
        self.connection = _PROVIDERS[provider]()
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.connect_over_cdp(self.connection.cdp_url)

        # Cloud browsers usually start with one context/page already open; reuse it.
        context = (
            self._browser.contexts[0]
            if self._browser.contexts
            else self._browser.new_context()
        )
        self.page = context.pages[0] if context.pages else context.new_page()
        return self

    def __exit__(self, *_exc: object) -> None:
        # Teardown is best-effort — never raise from cleanup.
        try:
            if self._browser is not None:
                self._browser.close()
        finally:
            if self._pw is not None:
                self._pw.stop()
