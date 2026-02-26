# Using Subconscious

<ResearchPreview />

Getting started with Subconscious is straightforward: **set your goals, make your tools, and call the Subconscious API**. The platform handles the complex reasoning and tool orchestration for you.

## Basic Workflow

1. **Define your prompt** - Describe what you want the agent to accomplish
2. **Create your tools** - Define the functions your agent can use (optional)
3. **Call the API** - Send your request and get intelligent results

## Code Examples

### Example 1: Calling an Agent with No Tools

The simplest use case - just send a prompt and get a response.

<CodeGroup>

```python Python
from openai import OpenAI

# Initialize the client with Subconscious endpoint
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# Make a simple request without tools
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "Find the derivative of f(x) = x^3 * sin(x)"
        }
    ]
)

print(response.choices[0].message.content)
```

```javascript JavaScript
import OpenAI from 'openai';

// Initialize the client with Subconscious endpoint
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// Make a simple request without tools
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: 'Analyze the current market trends for electric vehicles and provide a summary.'
    }
  ]
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

### Example 2: Calling an Agent with One Tool

Add a single tool to extend your agent's capabilities.

<CodeGroup>

```python Python
from openai import OpenAI

# Initialize the client with Subconscious endpoint
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# Define a tool for web search
tools = [
    {
        "type": "function",
        "name": "web_search",
        "description": "Search the web for current information",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query"
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }
    }
]

# Make request with one tool
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "Find the latest news about Tesla's stock performance this week."
        }
    ],
    tools=tools,
)

print(response.choices[0].message.content)
```

```javascript JavaScript
import OpenAI from 'openai';

// Initialize the client with Subconscious endpoint
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// Define a tool for web search
const tools = [
  {
    type: 'function',
    name: 'web_search',
    description: 'Search the web for current information',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          }
        },
        required: ['query']
        additionalProperties: false
    }
  }
];

// Make request with one tool
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: 'Find the latest news about Tesla\'s stock performance this week.'
    }
  ],
  tools: tools,
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

### Example 3: Calling an Agent with Multiple Tools

Combine multiple tools for more sophisticated agent behavior.

<CodeGroup>

```python Python
from openai import OpenAI

# Initialize the client with Subconscious endpoint
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# Define multiple tools
tools = [
    {
        "type": "function",
        "name": "web_search",
        "description": "Search the web for current information",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query"}
            },
            "required": ["query"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "calculate",
        "description": "Perform mathematical calculations",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "Mathematical expression to evaluate"}
            },
            "required": ["expression"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "send_email",
        "description": "Send an email notification",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "Email recipient"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body"}
            },
            "required": ["recipient", "subject", "body"]
        }
    }
]

# Make request with multiple tools
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "Research the current Bitcoin price, calculate the percentage change from last week, and email me a summary report."
        }
    ],
    tools=tools,
)

print(response.choices[0].message.content)
```

```javascript JavaScript
import OpenAI from 'openai';

// Initialize the client with Subconscious endpoint
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// Define multiple tools
const tools = [
  {
    type: 'function',
      name: 'web_search',
      description: 'Search the web for current information',
      url: TOOL_SERVER_URL,
      method: "GET" or "POST",
      timeout: SECONDS_TO_TIMEOUT,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
  },
  {
    type: 'function',
    name: 'calculate',
    description: 'Perform mathematical calculations',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression to evaluate' }
      },
      required: ['expression']
    }
  },
  {
    type: 'function',
    name: 'send_email',
    description: 'Send an email notification',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Email recipient' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' }
      },
      required: ['recipient', 'subject', 'body']
    }
  }
];

// Make request with multiple tools
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: 'Research the current Bitcoin price, calculate the percentage change from last week, and email me a summary report.'
    }
  ],
  tools: tools,
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

## Interpreting Results

Because Subconscious uses an OpenAI-compatible API, the response structure follows the standard OpenAI format. **All of the agent's reasoning and final answer is contained within the `choices[0].message.content` field as a JSON object**. This field is not a simple string - it's always a structured JSON that provides detailed insights into the agent's reasoning process and tool usage.

### Response Structure

The `choices[0].message.content` field contains JSON that always contains the engine's `reasoning` and `answer`. The object that follows this TypeScript interface:

```typescript
export interface ModelResponse {
  reasoning: Task[];
  answer: string;
}

export interface Task {
  thought?: string;
  title?: string;
  tooluse?: ToolCall;
  subtasks?: Task[];
  conclusion?: string;
}

export interface ToolCall {
  parameters: any;
  tool_name: string;
  tool_result: any;
}
```

### Response Fields Explained

- **`reasoning`**: An array of `Task` objects that show the agent's step-by-step reasoning process
- **`answer`**: The final, human-readable answer to your original prompt

### Task Structure

Each task in the reasoning array can contain:

- **`thought`**: The agent's internal reasoning about what to do next
- **`title`**: A descriptive title for this reasoning step
- **`tooluse`**: Details about a tool call, including:
  - `parameters`: The input parameters sent to the tool
  - `tool_name`: The name of the tool that was called
  - `tool_result`: The result returned by the tool
- **`subtasks`**: Nested tasks showing more detailed reasoning steps
- **`conclusion`**: The agent's conclusion after completing this reasoning step

### Example Response

The a simplified `choices[0].message.content` response will contain JSON like this:

```json
{
  "reasoning": [
    {
      "title": "Analyzing the request",
      "thought": "I need to search for information about Tesla's stock performance",
      "tooluse": {
        "tool_name": "web_search",
        "parameters": {
          "query": "Tesla stock performance this week"
        },
        "tool_result": {
          "results": [
            {
              "title": "Tesla Stock Analysis",
              "snippet": "Tesla's stock has shown..."
            }
          ]
        }
      },
      "conclusion": "Found relevant information about Tesla's stock performance"
    }
  ],
  "answer": "Based on my search, Tesla's stock performance this week shows..."
}
```

### Other Response Fields

The complete API response also includes:

- **`usage`** - Token usage information for the request
- **`model`** - The model that was used for the completion

This structured response format allows you to:
- **Understand** how your agent arrives at its final answer
- **Debug** your agent's reasoning process
- **Monitor** tool usage and results
- **Optimize** your tool configurations

