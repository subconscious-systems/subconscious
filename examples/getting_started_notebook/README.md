# Getting Started Notebook

Interactive Colab notebook to learn Subconscious from scratch — no experience required.

<a href="https://colab.research.google.com/github/subconscious-systems/subconscious/blob/main/examples/getting_started_notebook/getting_started.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

## What's Inside

The notebook walks through every core concept step by step:

1. **Install & setup** — one `pip install` and an API key
2. **First agent run** — a simple instruction with no tools
3. **Platform tools** — give the agent web search, news search, etc.
4. **Structured output** — get typed JSON responses with Pydantic models
5. **Engine comparison** — try `tim`, `tim-edge`, `tim-gpt`, and more
6. **Reasoning inspection** — peek at the agent's step-by-step thought process

## Run Locally

```bash
pip install .
export SUBCONSCIOUS_API_KEY=your_key
jupyter notebook getting_started.ipynb
```

## Run in Colab

Click the badge above — everything runs in the browser, no local setup needed.
