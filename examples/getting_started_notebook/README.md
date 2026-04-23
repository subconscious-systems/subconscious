# Getting Started Notebook

Interactive Colab notebook to learn Subconscious from scratch — no experience required.

<a href="https://colab.research.google.com/github/subconscious-systems/subconscious/blob/main/examples/getting_started_notebook/Subconscious%20Quickstart.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

## What's Inside

The notebook walks through every core concept step by step:

1. **Install & setup** — one `pip install` and an API key
2. **First agent run** — a simple instruction with **`tim-claude`**
3. **Platform tools** — web search, news search, etc.
4. **MCP tools** — connect to a hosted MCP server ([Context7](https://context7.com/) docs at `https://mcp.context7.com/mcp`) with no extra signup
5. **Structured output** — typed JSON responses with Pydantic models
6. **Engine comparison** — try `tim-claude`, `tim-claude-heavy`, `tim`, and more

## Run Locally

```bash
pip install .
export SUBCONSCIOUS_API_KEY=your_key
jupyter notebook "Subconscious Quickstart.ipynb"
```

## Run in Colab

Click the badge above — everything runs in the browser, no local setup needed.
