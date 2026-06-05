# Getting Started Notebook

Interactive Colab notebook to learn Subconscious from scratch — no experience required.

<a href="https://colab.research.google.com/github/subconscious-systems/subconscious/blob/main/examples/getting_started_notebook/Subconscious%20Quickstart.ipynb" target="_parent"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"/></a>

Subconscious is **OpenAI-compatible**, so the notebook uses the official `openai`
SDK pointed at `https://api.subconscious.dev/v1`.

## What's Inside

The notebook walks through every core concept step by step:

1. **Install & setup** — `pip install openai pydantic` and an API key
2. **First call** — a simple chat completion with `subconscious/tim-qwen3.6-27b`
3. **Streaming** — print the answer token-by-token
4. **Structured output** — typed JSON responses validated with Pydantic models
5. **Client-side tools** — a minimal Reason → Act → Observe loop that lets the model call your own functions

## Prerequisites

- Python 3.9+
- A Subconscious API key — get one at [subconscious.dev/platform](https://www.subconscious.dev/platform)

## Run Locally

```bash
pip install .
export SUBCONSCIOUS_API_KEY=your_key
jupyter notebook "Subconscious Quickstart.ipynb"
```

## Run in Colab

Click the badge above — everything runs in the browser, no local setup needed.

In Colab, add your key via **Secrets** (key icon in the left sidebar):
- Name: `SUBCONSCIOUS_API_KEY`
- Value: `your_key`

Then click **Run All**.

## Expected Output

After running all cells you should see:

- A plain-text explanation of what an API is (cell 5)
- A haiku about the ocean printed token-by-token (cell 7)
- `Sentiment: positive`, `Confidence: <float>`, `Keywords: [...]` (cell 9)
- `[tool] lookup_email(...)` lines followed by `Answer: Alice's email is alice@example.com` (cell 11)
