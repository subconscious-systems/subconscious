# City of Boston Subconscious Getting Started

Interactive Colab notebook to learn Subconscious from scratch — no experience required. Builds up to querying live City of Boston open data via MCP.

<a href="https://colab.research.google.com/github/subconscious-systems/subconscious/blob/main/examples/city_of_boston_getting_started/Boston%20Subconscious%20Quickstart.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

Subconscious is **OpenAI-compatible**, so the notebook uses the official `openai`
SDK pointed at `https://api.subconscious.dev/v1`.

## What's Inside

The notebook walks through every core concept step by step:

1. **Install & setup** — `pip install openai mcp pydantic` and an API key
2. **First call** — a simple chat completion with `subconscious/tim-qwen3.6-27b`
3. **Structured output** — typed JSON responses validated with Pydantic models
4. **Client-side MCP tools** — connect to the City of Boston open-data portal (`https://data-mcp.boston.gov/mcp`) and drive a Reason → Act → Observe loop over its tools, no extra signup

## Run Locally

```bash
pip install .
export SUBCONSCIOUS_API_KEY=your_key
jupyter notebook "Boston Subconscious Quickstart.ipynb"
```

## Run in Colab

Click the badge above — everything runs in the browser, no local setup needed.
