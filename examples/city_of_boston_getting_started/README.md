# City of Boston Subconscious Getting Started

Interactive Colab notebook to learn Subconscious from scratch — no experience required. Builds up to querying live City of Boston open data via MCP.

<a href="https://colab.research.google.com/github/subconscious-systems/subconscious/blob/main/examples/city_of_boston_getting_started/Subconscious%20Quickstart.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

## What's Inside

The notebook walks through every core concept step by step:

1. **Install & setup** — one `pip install` and an API key
2. **First agent run** — a simple instruction with **`tim-claude`**
3. **Platform tools** — web search, news search, etc.
4. **Structured output** — typed JSON responses with Pydantic models
5. **MCP tools** — connect to the City of Boston open data portal (`https://data-mcp.boston.gov/mcp`) with no extra signup
6. **Engines** — swap between `tim-claude`, `tim-gpt-heavy`, `tim`, and more

## Run Locally

```bash
pip install .
export SUBCONSCIOUS_API_KEY=your_key
jupyter notebook "Subconscious Quickstart.ipynb"
```

## Run in Colab

Click the badge above — everything runs in the browser, no local setup needed.
