# CLI Agent: Subconscious + E2B

A developer-first autonomous agent that reasons and executes code in a secure cloud sandbox. This agent uses **Subconscious** (via its OpenAI-compatible API) for reasoning and **E2B** for isolated code execution.

```
  ┌─┐┬ ┬┌┐ ┌─┐┌─┐┌┐┌┌─┐┌─┐┬┌─┐┬ ┬┌─┐
  └─┐│ │├┴┐│  │ ││││└─┐│  ││ ││ │└─┐
  └─┘└─┘└─┘└─┘└─┘┘└┘└─┘└─┘┴└─┘└─┘└─┘  + E2B Sandbox
```

## What it does

- **Client-side ReAct loop**: The agent reasons and executes tools entirely in-process — no server, no tunnel
- **Secure execution**: All code runs in isolated E2B cloud sandboxes
- **File I/O**: Upload local files, download generated outputs (charts, reports, data)
- **Multi-language**: Python, JavaScript, TypeScript, Go, Rust, C++, Ruby, Java, Bash
- **Data science ready**: numpy, pandas, matplotlib pre-installed
- **Command history**: Arrow keys navigate previous commands
- **Session persistence**: Sandbox is kept alive between tasks to avoid re-initialization overhead

## Quick Start

### Option 1: Use npx (easiest)

```bash
npx @subcon/e2b-cli
```

The CLI will prompt you for API keys on first run and save them for future sessions.

### Option 2: Install globally

```bash
npm install -g @subcon/e2b-cli
e2b-cli
```

### Option 3: Run from source (for development)

```bash
# Install dependencies
bun install

# Set your API keys
export SUBCONSCIOUS_API_KEY=your_key      # Get at https://subconscious.dev/platform
export E2B_API_KEY=your_e2b_key           # Get at https://e2b.dev

# Run the agent
bun run agent
```

## Example Usage

### Try it with the included demo file

```
▸ Task › Analyze file: ./demo_data.csv and create a summary of hours worked per employee
▸ Context ›
```

### Simple task (no files)
```
▸ Task › Calculate the first 50 Fibonacci numbers and identify which ones are prime
▸ Context ›
```

### Generate a chart
```
▸ Task › Analyze file: ./demo_data.csv and create a bar chart of total billable hours by department. Save to output: ./chart.png
▸ Context › Use pandas and matplotlib
```

### Full analysis with multiple outputs
```
▸ Task › Analyze file: ./demo_data.csv and do the following:
1. Create a chart of hours by employee. Save to output: ./hours_chart.png
2. Write a markdown report with key insights. Save to output: ./analysis.md
▸ Context › Use pandas and matplotlib
```

## File Handling

The agent supports file upload and download:

| Syntax | Description | Example |
|--------|-------------|---------|
| `file: ./path` | Upload a file to the sandbox | `Analyze file: ./data.csv` |
| `'/path/to/file'` | Quoted path (drag-and-drop) | `Analyze '/Users/me/data.csv'` |
| `output: ./path` | Download output when done | `Save chart to output: ./chart.png` |

> **Tip**: You can drag and drop files into the terminal and the quoted path will be automatically recognized and uploaded to the sandbox.

**Supported output formats:**

- Images: `.png`, `.jpg`, `.gif`, `.webp`, `.svg`
- Documents: `.md`, `.txt`, `.html`, `.pdf`
- Data: `.json`, `.csv`, `.xml`
- Archives: `.zip`, `.tar`, `.gz`

### How it works

1. Input files are uploaded to `/home/user/input/` in the sandbox
2. Output files are saved to `/home/user/output/` in the sandbox
3. When the agent completes, outputs are automatically downloaded to your specified local paths

## Supported Languages

| Language | Runtime | Notes |
|----------|---------|-------|
| Python | `python3` | numpy, pandas, matplotlib pre-installed |
| JavaScript | `node` | Node.js runtime |
| TypeScript | `ts-node` | Via npx |
| Bash | `bash` | Shell scripts |
| Go | `go run` | Single file execution |
| Rust | `rustc` | Compiled before execution |
| C++ | `g++` | Compiled with -O2 |
| C | `gcc` | Compiled with -O2 |
| Ruby | `ruby` | Standard runtime |
| Java | `javac` + `java` | Compiled and run |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Agent                                │
├─────────────────────────────────────────────────────────────────┤
│  User Input → Subconscious API (OpenAI-compatible)              │
│                  ↓ native tool_calls response                    │
│            Client-side tool loop (agent/loop.ts)                │
│                  ↓ dispatch per tool call                        │
│            Tool Executor (agent/executor.ts)                     │
│                  ↓ direct SDK calls                              │
│            E2B Sandbox (e2b/sandbox.ts)                         │
│                  ↓ stdout / stderr / files                       │
│            role:"tool" result → next model turn                  │
└─────────────────────────────────────────────────────────────────┘
```

### How the tool loop works

The Subconscious endpoint supports standard OpenAI function tools natively:

1. Tool schemas are passed via the standard `tools` field on each request.
2. When the model wants to call a tool, the response contains `message.tool_calls`.
3. The loop appends the assistant message (with `tool_calls`) and a `role:"tool"` result message for each call, then calls the API again.
4. When the model returns a reply with no `tool_calls`, that content is the final answer.

No HTTP server and no tunnel are required — tools run locally in this process.

### Source Structure

```
src/
  agent/
    loop.ts        # Client-side ReAct loop (Reason → Act → Observe)
    executor.ts    # Dispatches tool calls to E2B sandbox
    tools.ts       # E2B tool definitions and schemas
    prompt.ts      # System prompt builder
  cli/
    run.ts         # Interactive REPL with command history
    onboarding.ts  # First-run API key setup
  e2b/
    sandbox.ts     # E2B sandbox wrapper with multi-language support
  lib/
    client.ts      # OpenAI client pointed at Subconscious API
  types/
    agent.ts       # TypeScript definitions
  utils/
    retry.ts       # Exponential backoff retry
    validation.ts  # Input and path validation
  config.ts        # Configuration loading
  index.ts         # Entry point
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUBCONSCIOUS_API_KEY` | Yes | Your Subconscious API key |
| `E2B_API_KEY` | Yes | Your E2B API key |
| `VERBOSE` | No | Enable verbose logging (`true`/`false`) |

### Config file (optional)

Create `agent.config.json` to customize:

```json
{
  "environment": {
    "filterSensitive": true,
    "sensitivePatterns": ["KEY", "SECRET", "TOKEN", "PASSWORD"]
  }
}
```

## Troubleshooting

### Output files not appearing

1. Make sure you use the `output:` prefix in your task
2. Verify the agent called the `download_file` tool at the end
3. Check that the path is accessible (not a protected system directory)

### Sandbox timeout or slow startup

The first run may take 30–60 seconds as E2B provisions the sandbox and installs packages. Subsequent runs reuse the same sandbox session.

## Links

- [Subconscious](https://subconscious.dev) - AI reasoning platform
- [E2B](https://e2b.dev) - Secure code sandboxes

## License

Apache-2.0
