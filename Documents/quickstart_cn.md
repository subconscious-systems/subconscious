# 使用 Subconscious

<ResearchPreview />

开始使用 Subconscious 非常简单：**设定你的目标，创建你的工具，然后调用 Subconscious API**。平台会为你处理复杂的推理和工具编排。

## 基本工作流程

1. **定义你的提示词** - 描述你希望智能体完成的任务
2. **创建你的工具** - 定义智能体可以使用的函数（可选）
3. **调用 API** - 发送你的请求并获得智能结果

## 代码示例

### 示例 1：调用语言模型（无外部工具）

最简单的用例 - 仅发送提示词并获得响应。

<CodeGroup>

```python Python
from openai import OpenAI

# 使用 Subconscious 端点初始化客户端
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# 进行无工具的简单请求
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "求 f(x) = x^3 * sin(x) 的导数"
        }
    ]
)

print(response.choices[0].message.content)
```

```javascript JavaScript
import OpenAI from 'openai';

// 使用 Subconscious 端点初始化客户端
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// 进行无工具的简单请求
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: '分析当前电动汽车的市场趋势并提供摘要。'
    }
  ]
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

### 示例 2：一次模型调用，多次使用搜索工具

添加一个工具来扩展智能体的能力。模型返回结果时，用户定义的搜索工具会被动态，多次调用。

<CodeGroup>

Python代码示例：
```python Python
from openai import OpenAI

# 使用 Subconscious 端点初始化客户端
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# 定义一个网络搜索工具
tools = [
    {
        "type": "function",
        "name": "web_search",
        "description": "搜索网络以获取当前信息",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索查询"
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }
    }
]

# 使用一个工具进行请求
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "查找本周特斯拉股票表现的最新新闻。"
        }
    ],
    tools=tools,
)

print(response.choices[0].message.content)
```

Javascript代码示例：
```javascript JavaScript
import OpenAI from 'openai';

// 使用 Subconscious 端点初始化客户端
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// 定义一个网络搜索工具
const tools = [
  {
    type: 'function',
    name: 'web_search',
    description: '搜索网络以获取当前信息',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索查询'
          }
        },
        required: ['query']
        additionalProperties: false
    }
  }
];

// 使用一个工具进行请求
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: '查找本周特斯拉股票表现的最新新闻。'
    }
  ],
  tools: tools,
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

### 示例 3：调用具有多个工具的智能体

结合多个工具以实现更复杂的智能体行为，本质上仍为一次语言模型推理

<CodeGroup>

```python Python
from openai import OpenAI

# 使用 Subconscious 端点初始化客户端
client = OpenAI(
    base_url="https://api.subconscious.dev/v1",
    api_key="YOUR_API_KEY"
)

# 定义多个工具
tools = [
    {
        "type": "function",
        "name": "web_search",
        "description": "搜索网络以获取当前信息",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索查询"}
            },
            "required": ["query"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "calculate",
        "description": "执行数学计算",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "要计算的数学表达式"}
            },
            "required": ["expression"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "send_email",
        "description": "发送邮件通知",
        "url": "TOOL_SERVER_URL",
        "method": "GET" or "POST",
        "timeout": SECONDS_TO_TIMEOUT,
        "parameters": {
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "邮件收件人"},
                "subject": {"type": "string", "description": "邮件主题"},
                "body": {"type": "string", "description": "邮件正文"}
            },
            "required": ["recipient", "subject", "body"]
        }
    }
]

# 使用多个工具进行请求
response = client.chat.completions.create(
    model="tim-gpt",
    messages=[
        {
            "role": "user",
            "content": "研究当前比特币价格，计算与上周相比的百分比变化，并给我发邮件总结报告。"
        }
    ],
    tools=tools,
)

print(response.choices[0].message.content)
```

Javascript代码示例
```javascript JavaScript
import OpenAI from 'openai';

// 使用 Subconscious 端点初始化客户端
const client = new OpenAI({
  baseURL: 'https://api.subconscious.dev/v1',
  apiKey: 'YOUR_API_KEY'
});

// 定义多个工具
const tools = [
  {
    type: 'function',
      name: 'web_search',
      description: '搜索网络以获取当前信息',
      url: TOOL_SERVER_URL,
      method: "GET" or "POST",
      timeout: SECONDS_TO_TIMEOUT,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' }
        },
        required: ['query']
      }
  },
  {
    type: 'function',
    name: 'calculate',
    description: '执行数学计算',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要计算的数学表达式' }
      },
      required: ['expression']
    }
  },
  {
    type: 'function',
    name: 'send_email',
    description: '发送邮件通知',
    url: TOOL_SERVER_URL,
    method: "GET" or "POST",
    timeout: SECONDS_TO_TIMEOUT,
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: '邮件收件人' },
        subject: { type: 'string', description: '邮件主题' },
        body: { type: 'string', description: '邮件正文' }
      },
      required: ['recipient', 'subject', 'body']
    }
  }
];

// 使用多个工具进行请求
const response = await client.chat.completions.create({
  model: 'tim-gpt',
  messages: [
    {
      role: 'user',
      content: '研究当前比特币价格，计算与上周相比的百分比变化，并给我发邮件总结报告。'
    }
  ],
  tools: tools,
});

console.log(response.choices[0].message.content);
```

</CodeGroup>

## 解读结果

由于 Subconscious 使用兼容 OpenAI 的 API，响应结构遵循标准的 OpenAI 格式。**所有智能体的推理和最终答案都包含在 `choices[0].message.content` 字段中作为 JSON 对象**。这个字段不是简单的字符串 - 它始终是一个结构化的 JSON，提供对智能体推理过程和工具使用的详细洞察。

### 响应结构

`choices[0].message.content` 字段包含的 JSON 始终包含引擎的 `reasoning` 和 `answer`。该对象遵循以下 TypeScript 接口：

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

### 响应字段说明

- **`reasoning`**：一个 `Task` 对象数组，显示智能体的逐步推理过程
- **`answer`**：对你原始提示词的最终、人类可读的答案

### 任务结构

推理数组中的每个任务可以包含：

- **`thought`**：智能体关于下一步操作的内部推理
- **`title`**：此推理步骤的描述性标题
- **`tooluse`**：工具调用的详细信息，包括：
  - `parameters`：发送给工具的输入参数
  - `tool_name`：被调用工具的名称
  - `tool_result`：工具返回的结果
- **`subtasks`**：嵌套任务，显示更详细的推理步骤
- **`conclusion`**：智能体完成此推理步骤后的结论

### 示例响应

简化的 `choices[0].message.content` 响应将包含如下 JSON：

```json
{
  "reasoning": [
    {
      "title": "分析请求",
      "thought": "我需要搜索有关特斯拉股票表现的信息",
      "tooluse": {
        "tool_name": "web_search",
        "parameters": {
          "query": "特斯拉股票本周表现"
        },
        "tool_result": {
          "results": [
            {
              "title": "特斯拉股票分析",
              "snippet": "特斯拉的股票表现显示..."
            }
          ]
        }
      },
      "conclusion": "找到了关于特斯拉股票表现的相关信息"
    }
  ],
  "answer": "根据我的搜索，特斯拉本周的股票表现显示..."
}
```

### 其他响应字段

完整的 API 响应还包括：

- **`usage`** - 请求的令牌使用信息
- **`model`** - 用于补全的模型

这种结构化响应格式允许你：
- **理解** 你的智能体如何得出最终答案
- **调试** 你的智能体推理过程
- **监控** 工具使用和结果
- **优化** 你的工具配置