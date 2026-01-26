# CLI Agent: Subconscious + E2B

A developer-first autonomous agent that reasons and executes code in a secure cloud sandbox. This agent uses **Subconscious** for long-horizon reasoning and **E2B** for isolated code execution.

```
  ┌─┐┬ ┬┌┐ ┌─┐┌─┐┌┐┌┌─┐┌─┐┬┌─┐┬ ┬┌─┐
  └─┐│ │├┴┐│  │ ││││└─┐│  ││ ││ │└─┐
  └─┘└─┘└─┘└─┘└─┘┘└┘└─┘└─┘┴└─┘└─┘└─┘  + E2B Sandbox
```

## What it does

- **Long-horizon reasoning**: Subconscious handles complex multi-step tasks with planning and self-correction
- **Secure execution**: All code runs in isolated E2B cloud sandboxes
- **File I/O**: Upload local files, download generated outputs (charts, reports, data)
- **Multi-language**: Python, JavaScript, TypeScript, Go, Rust, C++, Ruby, Java, Bash
- **Data science ready**: numpy, pandas, matplotlib pre-installed
- **Command history**: Arrow keys navigate previous commands
- **Zero-config tunneling**: Works out of the box - no external dependencies

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
export SUBCONSCIOUS_API_KEY=your_key_here  # Get at https://subconscious.dev/platform
export E2B_API_KEY=your_key_here           # Get at https://e2b.dev

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
| `files: ./dir/*.csv` | Upload multiple files (glob) | `Process files: ./reports/*.csv` |
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
│  User Input  ->  File Parser  ->  Subconscious API  ->  Display │
│                      |                  |                        │
│               Upload Files      Stream Reasoning                 │
│                      |                  |                        │
│              E2B Sandbox  <---  Tool Calls (execute_code)       │
│                      |                                           │
│              Download Outputs  ->  Local Filesystem              │
└─────────────────────────────────────────────────────────────────┘
```

### Source Structure

```
src/
  cli/
    run.ts              # Interactive CLI with command history
    fileParser.ts       # Parses file:/output: references
  e2b/
    sandbox.ts          # E2B sandbox wrapper with multi-language support
  tools/
    e2bServer.ts        # HTTP server exposing execute_code tool
    tunnel.ts           # Tunnel management (localtunnel)
  types/
    agent.ts            # TypeScript definitions
  config.ts             # Configuration loading
  index.ts              # Entry point
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUBCONSCIOUS_API_KEY` | Yes | Your Subconscious API key |
| `E2B_API_KEY` | Yes | Your E2B API key |
| `TUNNEL_URL` | No | Use existing tunnel instead of auto-start |
| `VERBOSE` | No | Enable verbose logging (`true`/`false`) |

### Config file (optional)

Create `agent.config.json` to customize:

```json
{
  "tunnel": {
    "enabled": true,
    "autoStart": true,
    "port": 3001
  },
  "tools": {
    "port": 3001,
    "host": "localhost"
  },
  "environment": {
    "filterSensitive": true,
    "sensitivePatterns": ["KEY", "SECRET", "TOKEN", "PASSWORD"]
  }
}
```

## Troubleshooting

### Tunnel not starting

The agent uses `localtunnel` which is installed automatically with `bun install`. If you're having issues:

1. **Check your network** - localtunnel requires outbound internet access
2. **Use an existing tunnel** - Set `TUNNEL_URL` environment variable to bypass auto-start

### Output files not appearing

1. Make sure you use the `output:` prefix in your task
2. Check that the agent says `[file] Downloaded:` at the end
3. Verify the path is accessible (not a protected system directory)

### Sandbox timeout or slow startup

The first run may take 30-60 seconds as E2B provisions the sandbox and installs packages. Subsequent runs are faster.

## Links

- [Subconscious](https://subconscious.dev) - Long-horizon AI reasoning
- [E2B](https://e2b.dev) - Secure code sandboxes
- [localtunnel](https://github.com/localtunnel/localtunnel) - Tunnel service

## License

Apache-2.0
