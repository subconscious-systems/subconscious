# n8n-nodes-subconscious

This is an n8n community node for [Subconscious](https://subconscious.dev) - an AI agent platform that enables complex reasoning with tools.

Subconscious provides AI agents that can search the web, understand webpages, and execute multi-step reasoning tasks. This node lets you integrate Subconscious agents directly into your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

```bash
# In your n8n installation directory
npm install n8n-nodes-subconscious
```

## Credentials

You need a Subconscious API key to use this node:

1. Sign up at [subconscious.dev/platform](https://subconscious.dev/platform)
2. Generate an API key from your dashboard
3. In n8n, create new credentials of type **Subconscious API**
4. Paste your API key

## Usage

The Subconscious node runs an AI agent with your instructions and waits for the result.

### Basic Example

1. Add a **Subconscious** node to your workflow
2. Select an engine (TIM-GPT recommended)
3. Enter your instructions (e.g., "Search for the latest AI news and summarize the top 3 stories")
4. Select platform tools (e.g., Web Search)
5. Execute - the node returns the agent's response

### Parameters

| Parameter | Description |
|-----------|-------------|
| **Engine** | The AI engine to use (TIM-GPT, TIM-Edge, or TIM-GPT-Heavy) |
| **Instructions** | The task for the agent to execute |
| **Platform Tools** | Built-in tools like web search, webpage understanding, etc. |

### Additional Options

| Option | Description |
|--------|-------------|
| **Answer Format** | JSON Schema to enforce structured output |
| **Custom Tools** | Add custom function tools as JSON |
| **Polling Interval** | How often to check for completion (ms) |
| **Timeout** | Maximum wait time (seconds) |

## Engines

| Engine | Description |
|--------|-------------|
| **TIM-GPT** (Recommended) | Complex reasoning engine backed by GPT-4.1 |
| **TIM-Edge** | Highly efficient engine tuned for performance |
| **TIM-GPT-Heavy** | Most powerful engine backed by GPT-5.2 |

## Platform Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web using Google |
| `webpage_understanding` | Extract and summarize webpage content |
| `parallel_search` | Precision search from authoritative sources |
| `parallel_extract` | Extract specific content from webpages |
| `exa_search` | Semantic search for high-quality content |
| `exa_crawl` | Retrieve full webpage content |
| `exa_find_similar` | Find pages similar to a given URL |

## Structured Output

Use the **Answer Format** option to get structured JSON responses:

```json
{
  "type": "object",
  "title": "SearchResults",
  "properties": {
    "summary": { "type": "string" },
    "keyPoints": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["summary", "keyPoints"]
}
```

## Compatibility

- Minimum n8n version: 1.0.0
- Tested with n8n 1.x and 2.x

## Resources

- [Subconscious Documentation](https://docs.subconscious.dev)
- [Subconscious Platform](https://subconscious.dev/platform)
- [API Reference](https://docs.subconscious.dev/api-reference/introduction)
- [n8n Community Nodes](https://docs.n8n.io/integrations/#community-nodes)

## License

MIT

## Version History

### 0.1.0
- Initial release
- Run AI agents with automatic wait for completion
- Support for TIM-Edge, TIM-GPT, and TIM-GPT-Heavy engines
- Platform tools integration (web search, webpage understanding, etc.)
- Structured output support with JSON Schema
- Custom tools support
