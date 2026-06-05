# Search Agent CLI

A Python command-line interface (CLI) that answers research questions using a
client-side ReAct (Reason + Act) agent loop backed by the
[Subconscious AI platform](https://subconscious.dev).

## Architecture

Subconscious exposes an **OpenAI Chat Completions-compatible** endpoint
(`https://api.subconscious.dev/v1`) that supports standard OpenAI function
tools. All tool execution happens client-side:

1. The model receives a native `tools` list and decides when to call
   `web_search`.
2. When it emits `tool_calls`, the CLI executes the real DuckDuckGo search
   locally (via the `ddgs` package — no API key required) and feeds each
   result back as a `role: "tool"` message.
3. The loop repeats until the model returns a plain content reply with no
   `tool_calls`.

**Model:** `subconscious/tim-qwen3.6-27b`

## Features

- **Client-side ReAct loop** — no server-side tools needed
- **Live progress** — see each search query as it runs
- **DuckDuckGo search** — real web results with no extra API key
- **Timeout protection** — configurable wall-clock limit
- **User-friendly error messages** — authentication, rate-limit, and
  unexpected errors all shown clearly

## Installation

### Prerequisites

- Python 3.9 or higher
- A Subconscious API key ([get one here](https://www.subconscious.dev/platform))

### Setup

1. Navigate to this directory:

   ```bash
   cd search_agent_cli
   ```

2. Install dependencies:

   ```bash
   pip install .
   ```

3. Set your API key:

   ```bash
   export SUBCONSCIOUS_API_KEY=your_key
   ```

   Or create a `.env` file in this directory:

   ```
   SUBCONSCIOUS_API_KEY=your_key
   ```

## Usage

```bash
python cli.py "Your research question here"
```

With a custom timeout (seconds):

```bash
python cli.py "Your question" --timeout 180
```

### Example

```bash
python cli.py "What are the latest developments in AI agents?"
```

**Output:**

```
Searching: latest AI agents developments 2024
Searching: recent AI agent research breakthroughs

Answer:

[answer streams in after the search loop completes]

Complete
```

## How It Works

```
User question
      |
      v
  [ Model ]  <-- messages + native function tools
      |
  message.tool_calls set?
      |             |
     YES            NO
      |             |
  web_search        v
  (DuckDuckGo)   Print answer
      |
  Append role="tool" result messages
      |
  Loop to [ Model ]
```

The loop runs for at most 15 steps before raising an error.

## Troubleshooting

### Authentication Error

1. Verify your key at https://www.subconscious.dev/platform
2. Check the variable is exported:
   ```bash
   echo $SUBCONSCIOUS_API_KEY
   ```

### Rate Limit Error

Wait a moment and retry. Check your usage at
https://www.subconscious.dev/platform.

### No Answer Returned

- Try rephrasing the question
- Increase the timeout: `--timeout 600`

## Learn More

- **Documentation**: https://docs.subconscious.dev
- **API Reference**: https://docs.subconscious.dev/api-reference
- **Platform Dashboard**: https://www.subconscious.dev/platform

## License

Apache-2.0
