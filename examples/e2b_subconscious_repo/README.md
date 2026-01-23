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
- **Auto-tunneling**: Cloudflare tunnel starts automatically

## Quick Start

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

### Simple task (no files)
```
▸ Task › Calculate the first 50 Fibonacci numbers and identify which ones are prime
▸ Context ›
```

### Analyze a file
```
▸ Task › Analyze file: ./sales_data.csv and tell me the top 3 products by revenue
▸ Context ›
```

### Generate a chart
```
▸ Task › Read file: ./metrics.csv and create a line chart of MRR over time. Save to output: ./mrr_chart.png
▸ Context ›
```

### Full analysis with multiple outputs
```
▸ Task › Analyze file: /Users/me/Desktop/startup_metrics.csv and do the following:
1. Create a dual-axis chart of MRR and Customers over time. Save to output: /Users/me/Desktop/growth.png
2. Write a markdown report with key insights. Save to output: /Users/me/Desktop/analysis.md
▸ Context › Use pandas and matplotlib
```

## File Handling

The agent supports file upload and download:

| Syntax | Description | Example |
|--------|-------------|---------|
| `file: ./path` | Upload a file to the sandbox | `Analyze file: ./data.csv` |
| `files: ./dir/*.csv` | Upload multiple files (glob) | `Process files: ./reports/*.csv` |
| `output: ./path` | Download output when done | `Save chart to output: ./chart.png` |

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
    tunnel.ts           # Cloudflare tunnel management
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

### cloudflared not found

Install Cloudflare Tunnel:

```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

### Output files not appearing

1. Make sure you use the `output:` prefix in your task
2. Check that the agent says `[file] Downloaded:` at the end
3. Verify the path is accessible (not a protected system directory)

### Sandbox timeout or slow startup

The first run may take 30-60 seconds as E2B provisions the sandbox and installs packages. Subsequent runs are faster.

## Links

- [Subconscious](https://subconscious.dev) - Long-horizon AI reasoning
- [E2B](https://e2b.dev) - Secure code sandboxes
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

## License

Apache-2.0
