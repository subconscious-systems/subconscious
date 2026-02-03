# TIMRUN: Efficient Engine for Long-horizon Reasoning

<div align="center">

<a href="https://www.subconscious.dev/" style="text-decoration: none;">
  <img src="assets/imgs/logo.png" alt="Subconscious Systems" width="80" height="80" style="border-radius: 12px; margin-bottom: 8px;">
</a>

<h3 style="margin: 8px 0;">
  <a href="https://www.subconscious.dev/" style="text-decoration: none; color: inherit;">
    Try on Subconscious Systems
  </a>
  <a href="https://www.subconscious.dev/" style="text-decoration: none; color: #007acc; font-size: 0.8em; margin-left: 4px;">
    [link]
  </a>
</h3>

[![Paper](https://img.shields.io/badge/paper-arXiv-red.svg)](https://arxiv.org/pdf/2507.16784)
[![Hugging Face](https://img.shields.io/badge/🤗%20Hugging%20Face-Models-yellow)](https://huggingface.co/SubconsciousDev/TIM-8b-preview)

*Enabling efficient multi-hop reasoning and tool use for extended problem-solving*

</div>

## 🚀 Overview

**TIMRUN** (TIM Runtime) is a high-performance inference engine that orchestrates the **TIM (Thread Inference Model)** for unprecedented long-horizon reasoning capabilities. TIMRUN manages the entire inference pipeline, using TIM to predict next tokens while performing intelligent structure checks to extract tool calls and identify prunable subtasks. This enables efficient end-to-end multi-hop tool use and makes complex problem-solving tasks more scalable.

### Key Features

- 🔗 **Multi-hop Reasoning**: Chain complex reasoning steps across extended contexts
- 🛠️ **End-to-End Tool Integration**: Seamlessly incorporate external tools and APIs
- 🎯 **Long-horizon Planning**: Handle tasks requiring extended planning and execution
- 🧠 **Generative Orchestration**: Intelligent context engineering learned by the TIM model and handled by TIMRUN with efficient KV cache pruning

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────────────────────────────┐
│   Input Query   │───▶│              TIMRUN Engine              │
│                 │    │                                         │
└─────────────────┘    │  ┌─────────────────┐                    │
                       │  │ Structure Check │                    │
                       │  │                 │                    │
                       │  │ • Tool Calls    │                    │
                       │  │ • Prunable      │                    │
                       │  │   Subtasks      │                    │
                       │  └─────────────────┘                    │
                       │           │                             │
                       │           ▼                             │
                       │  ┌─────────────────┐                    │
                       │  │   TIM Model     │                    │
                       │  │                 │                    │
                       │  │  • Sparse Attn  │ ─────────────      │
                       │  │  • Multi-hop    │             │      │
                       │  │  • Token Pred   │             │      │
                       │  └─────────────────┘             │      │
                       │           │                      │      │
                       │           ▼                      ▼      │
┌─────────────────┐    │  ┌─────────────────┐    ┌─────────────┐ │
│   Tool Usage    │◀───┼──│  Tool Execution │    │ KV Cache    │ │
│                 │    │  │                 │    │ Pruning     │ │
│  • External APIs│    │  │ • Call Tools    │    │             │ │
│  • Tool Calls   │    │  │ • Encode        │    │ • Memory    │ │
│  • Data Sources │    │  │   Response      │    │   Mgmt      │ │
└─────────────────┘    │  └─────────────────┘    └─────────────┘ │
                       │           │                      │      │
                       │           ▼                      ▼      │
                       │  ┌─────────────────────────────────────┐│
                       │  │         Continue Decoding           ││
                       │  │      (with updated context)         ││
                       │  └─────────────────────────────────────┘│
                       └─────────────────────────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │   Final Result  │
                               │                 │
                               └─────────────────┘
```

## 🚀 Quick Start

### Create a New Project

The fastest way to get started is with our CLI:

```bash
npx create-subconscious-app
```

This will guide you through creating a new project from our example templates.

### Subconscious Python SDK

Install the package using pip:

```bash
pip install subconscious-python
```

> **Note**: The package name is `subconscious-python` but you import it as `subconscious`:
> ```python
> import subconscious  # Import name remains clean and simple
> ```

Run your first agent:
```python
from subconscious import Client

# Initialize the client
client = Client(
    base_url="https://api.subconscious.dev/v1", # can be omitted
    api_key="your-api-key" # get it from https://subconscious.dev
)

# Define tools
tools = [
    {
        "type": "function",
        "name": "calculator",
        "url": "https://URL_TO_CALCULATOR_TOOL/ENDPOINT", # the server url of your own tool
        "method": "POST",
        "timeout": 5, # seconds
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string"},
                "a": {"type": "number"},
                "b": {"type": "number"}
            },
            "required": ["operation", "a", "b"]
        }
    }
]

# Build toolkit
client.build_toolkit(tools, agent_name="math_agent")

# Run agent
messages = [{"role": "user", "content": "What is 2 + 3?"}]
response = client.agent.run(messages, agent_name="math_agent")
print(response)
```

The TIM language model will call the `calculator` tool as many times as necessary, handle excepts, compute the answer, and return the result. The agent is completed with one language model API call!

We also provide fine-grained control over the reasoning structure, tool use, and memory management. Check out the [deep research agent example](examples/deep_research) for more advanced usage.

### OpenAI Compatible API

> Note: The OpenAI compatible API does not support fine-grained reasoning structure control. For advanced performance tuning, please use the Subconscious Python SDK.

```python
client = OpenAI(
    base_url = "https://api.subconscious.dev/v1",
    api_key = # get API KEY from https://subconscious.dev
)
```

### Reasoning with Multi-hop Search Tool Calls

```python
resp = client.chat.completions.create(
    model = "tim-large",
    messages = [
        {
            'role': 'user',
            'content': 'find 10 most influencial research papers in dog walking.'
        }
    ],
    top_p = 0.95,
    max_completion_tokens = 10000,
    temperature = 0.6,
    tools = [
        {
            "type": "function",
            "name": "SearchTool",
            "description": "a general search engine returns title, url, and desciription of 10 webpages",
            "url": URL_TO_TOOL, # the server url of your own tool
            "method": "POST",
            "timeout": 10,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "A natural language query for the search engine."
                    }
                },
                "required": [
                    "query"
                ],
                "additionalProperties": False
            }
        }
    ]
    stream = False # if true, same as OpenAI's streaming
)
print(json.loads(resp.choices[0].message.content)['answer'])
```

## 🤖 Showcase agents built with TIM

- [AP CS test assistant](https://github.com/aivyngo/public-ap-csa-agent)
- [Arxiv podcast writer - coming soon]
- [Legal research agent - coming soon]

## 🛠️ Available Tools

coming soon

## 📊 Performance

### Optimization Features

- **Selective Working Memory**: 50% reduction in memory usage for long sequences
- **Tool Caching**: 30% faster repeated tool calls
- **Batched Processing**: Multi-threaded tool execution when possible
- **Memory Management**: Efficient handling of large reasoning chains

## 📚 Documentation

- [Getting Started Guide](https://docs.subconscious.dev/quickstart)
- [Available Models](https://docs.subconscious.dev/platform/models)
- [Tool Development](https://docs.subconscious.dev/platform/tools)
- [API Reference](https://docs.subconscious.dev/platform/using-subconscious)

## 🔬 Research & Papers

If you use found our work helpful in your research, please cite:

```bibtex
@article{tim-timrun,
  title={Beyond Context Limits: Subconscious Threads for Long-Horizon Reasoning},
  author={Hongyin Luo, Nathaniel Morgan, Tina Li, Derek Zhao, Ai Vy Ngo, Philip Schroeder, Lijie Yang, Assaf Ben-Kish, Jack O'Brien, James Glass},
  journal={arXiv preprint arXiv:2507.16784},
  year={2024}
}
```

## 📄 License

This TIM-8b-preview model is licensed under the MIT License.

## 📞 Support

- 📧 Email: hongyin OR jack AT subconscious DOT dev
- 🐛 Issues: [GitHub Issues](https://github.com/subconscious-systems/TIMRUN/issues)
- 📖 Documentation: [docs.subconscious.dev/](https://docs.subconscious.dev/)

---

<div align="center">
<strong>Ready to unlock the power of long-horizon reasoning? Get started with TIMRUN today!</strong>
</div>