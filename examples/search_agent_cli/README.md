# Getting Started Search Agent

A Python command-line interface (CLI) that demonstrates how to use [Subconscious's AI agents](https://subconscious.dev) to perform deep web research. This CLI showcases Subconscious's tool-calling abilities and streaming capabilities.

## Features

- 🔍 **Deep Research**: Perform comprehensive web research with multi-source information gathering
- 🧠 **Live Thinking Feedback**: See the agent's thoughts in real-time as it reasons through your question
- 🌊 **Streaming**: See results in real-time as they're generated, with live thought updates
- ⚡ **Error Handling**: User-friendly error messages with actionable guidance

## Installation

### Prerequisites

- Python 3.8 or higher
- A Subconscious API key ([get one here](https://www.subconscious.dev/platform))

### Setup

1. **Clone or navigate to this directory**:

   ```bash
   cd search_agent_cli
   ```

2. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

   Or using `uv`:

   ```bash
   uv pip install -r requirements.txt
   ```

3. **Set your API key**:

   ```bash
   export SUBCONSCIOUS_API_KEY='your-api-key-here'
   ```

   Or create a config file at `~/.subconscious/config` with your API key.

## Quick Start

### Basic Usage (Streaming with Live Thoughts)

The simplest way to use the CLI - just ask a question and see results stream in real-time:

```bash
python cli.py "What are the latest developments in quantum computing?"
```

This will show:

- 💭 Thoughts appearing in dim text as the agent thinks
- The final answer streaming in real-time

## Usage Examples

### Example 1: Basic Research Query

```bash
python cli.py "What are the latest developments in quantum computing and how might they impact cryptography?"
```

**Output:**

````
💭 Starting with a methodical plan: I'll define objectives...
💭 The official documentation will provide authoritative information...
💭 I need to search multiple sources for diverse perspectives...

Answer:

[comprehensive answer streams in real-time]

✓ Complete

### Usage

Stream search results in real-time with live thought feedback. You'll see the agent's thoughts appear as it reasons through your question.

**Usage:**

```bash
python cli.py QUESTION
````

**Arguments:**

- `QUESTION` (required): The research question to answer

**What You'll See:**

- 💭 Thoughts appearing in dim text as the agent thinks
- Answer streaming in real-time
- Citations at the end

**Available Search Tools:**

The agent automatically has access to all these tools and chooses which to use:

- **Platform Tools**: `parallel_search` (Subconscious's precision search)
- **Custom Providers**: `exa`, `google`, `jina`, `tavily`, `serper`, `parallel`

You don't need to specify which tools to use - the agent decides automatically based on your query.

## How It Works

### Research Process

The agent follows this methodology:

1. **Analyze the question**: Break down complex questions into sub-questions
2. **Multi-source research**: Query multiple sources for diverse perspectives
3. **Evaluate credibility**: Assess source reliability and prefer authoritative sources
4. **Cross-reference**: Verify facts across multiple sources
5. **Synthesize**: Combine information into coherent narratives
6. **Cite sources**: Include URLs and references for all factual claims
7. **Suggest follow-ups**: Provide questions for deeper exploration

### Available Search Tools

The agent automatically has access to all these tools and intelligently selects which ones to use:

**Platform Tools** (hosted by Subconscious):

- `parallel_search` - Precision search from authoritative sources

**Custom Search Providers**:

- `exa` - Exa AI for fast, accurate answers from high-quality sources
- `google` - Google Search API for comprehensive results
- `jina` - Jina AI for semantic search capabilities
- `tavily` - Tavily for research-focused search results
- `serper` - Serper API for Google search results
- `parallel` - Parallel Web Systems for precision search

You don't need to choose which tools to use - the agent decides automatically based on your query and the type of information needed.

### Streaming with Live Thoughts

When using the CLI, you'll see:

- **Thoughts** (💭): The agent's internal reasoning as it thinks through your question, displayed in dim text
- **Answer**: The final answer streaming in real-time as it's generated
- **Citations**: Automatically extracted sources at the end

## Troubleshooting

### Authentication Error

If you see an authentication error:

1. Verify your API key at https://www.subconscious.dev/platform
2. Check that `SUBCONSCIOUS_API_KEY` is set correctly:
   ```bash
   echo $SUBCONSCIOUS_API_KEY
   ```
3. Make sure the API key is set correctly in your environment

### Rate Limit Error

If you hit rate limits:

1. Wait a few moments before retrying
2. Check your usage at https://www.subconscious.dev/platform
3. Consider upgrading your plan if needed

### No Results Returned

If a run completes but returns no results:

- The query might be too vague or too specific
- Try rephrasing the question
- Check that the engine is available (some engines may be in preview)

## Advanced Usage

The CLI streams results in real-time with live thoughts. Simply ask your question:

```bash
python cli.py "Your research question here"
```

## Learn More

- **Documentation**: https://docs.subconscious.dev
- **Mental Model**: https://docs.subconscious.dev/mental-model
- **API Reference**: https://docs.subconscious.dev/api-reference
- **Platform Dashboard**: https://www.subconscious.dev/platform

## Contributing

This is a demonstration project. Feel free to:

- Modify it for your own use cases
- Add new search providers or tools
- Enhance the streaming experience
- Improve error handling
- Add new features or rigor levels

## License

Apache-2.0

## Support

For questions and support:

- Documentation: https://docs.subconscious.dev
- Meet with an engineer: https://calendly.com/jack-subconscious/
