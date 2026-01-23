# CLI Agent: Subconscious + E2B

A developer-first autonomous agent that reasons and executes code, inspired by Claude Code. This agent uses **Subconscious** for reasoning and tool orchestration, and **E2B** as the execution environment via FunctionTool.

## Mental Model

- **Subconscious** = Brain (reasoning, planning, tool orchestration)
- **E2B** = Execution environment (isolated code sandbox exposed as FunctionTool)
- **Agent Flow** = Subconscious streams reasoning → calls E2B tool → continues based on results

This differs from hardcoded workflows: Subconscious handles all reasoning, planning, and tool orchestration natively. The agent streams its reasoning in real-time and calls tools as needed.

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment variables
cp .env.example .env

# Edit .env and add your API keys:
# - SUBCONSCIOUS_API_KEY: Get it at https://www.subconscious.dev/platform
# - E2B_API_KEY: Get it at https://e2b.dev (optional)

# Run the agent
bun run agent
```

> **Note**: Bun automatically loads `.env` files, so no additional configuration is needed.

## Cloudflare Tunnel

The agent automatically starts a Cloudflare tunnel to expose the local tool server to Subconscious. No manual setup required!

**Requirements:**
- `cloudflared` must be installed: `brew install cloudflare/cloudflare/cloudflared`
- If not installed, the agent will show clear installation instructions

**Optional:** If you want to use an existing tunnel URL instead, set:
```bash
export TUNNEL_URL=https://your-existing-tunnel-url.trycloudflare.com
```

The tunnel is automatically cleaned up when the agent finishes.

## Example

**Input:**
```
Task: Create a Python script that generates Fibonacci numbers up to 100
Context: Use a simple iterative approach
```

**Output:**
```
🤖 CLI Agent (Subconscious + E2B)
==================================

This agent uses:
  • Subconscious = reasoning & tool orchestration
  • E2B = code execution environment (via FunctionTool)

[server] Tool server running at http://localhost:3001
[tunnel] Using tunnel: https://xxxx-xxxx.trycloudflare.com

[agent] Starting Subconscious agent...

💭 I need to create a Python script that generates Fibonacci numbers up to 100 using an iterative approach.

🔧 Calling tool: execute_code
   Code: def fibonacci(n):...

[result] Execution succeeded

📋 Final Answer:

I've created a Python script that generates Fibonacci numbers up to 100. The sequence is: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89.

[done] Agent finished
```

## Architecture

```
/src
  /cli
    run.ts              # CLI entrypoint with streaming
    fileParser.ts       # File reference parsing
  /tools
    e2bServer.ts        # HTTP server for E2B FunctionTool
    tunnel.ts           # Cloudflare tunnel management
  /e2b
    sandbox.ts          # E2B sandbox wrapper
  /types
    agent.ts            # Type definitions
  /config.ts            # Configuration management
  index.ts              # Main entrypoint
```

## Design Principles

1. **Subconscious-native**: Uses Subconscious's built-in tool orchestration
2. **Streaming**: Real-time reasoning and output display
3. **FunctionTool-based**: E2B exposed as HTTP endpoint for Subconscious
4. **Minimal dependencies**: Bun native tooling where possible
5. **Inspectable**: Every reasoning step and tool call is visible
6. **Type-safe**: Full TypeScript

## How It Works

1. **User provides task** via CLI prompt
2. **Tool server starts** on localhost (default: port 3001)
3. **Tunnel exposes server** to Subconscious (Cloudflare Tunnel)
4. **Subconscious streams** reasoning and tool calls
5. **E2B tool executes** code when Subconscious calls it
6. **Subconscious continues** based on tool results
7. **Final answer** is displayed when complete

## Configuration

### Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Required variables:

- `SUBCONSCIOUS_API_KEY` (required): Your Subconscious API key
  - Get it at: https://www.subconscious.dev/platform
  
- `E2B_API_KEY` (optional): E2B API key (SDK may use default authentication)
  - Get it at: https://e2b.dev

- `TUNNEL_URL` (optional): Cloudflare tunnel URL (if not using auto-start)
  - Format: `https://xxxx-xxxx.trycloudflare.com`

### Configuration File

Create `agent.config.json` to customize behavior:

```json
{
  "tunnel": {
    "enabled": true,
    "autoStart": false,
    "port": 3001,
    "cloudflaredPath": "cloudflared"
  },
  "tools": {
    "port": 3001,
    "host": "localhost"
  },
  "timeouts": {
    "defaultExecution": 300000,
    "maxExecution": 1800000,
    "perStep": 600000
  }
}
```

## File Handling

The agent supports file uploads and downloads:

- **Upload files**: Use `file: ./path/to/file` in your task description
- **Specify outputs**: Use `output: ./path/to/output` in your task description
- **Multiple files**: Use `files: ./dir/*.csv` for multiple files

Example:
```
Task: Process file: ./data.csv and save results to output: ./results.json
```

## Troubleshooting

### "Tunnel required but not started"

- Set `TUNNEL_URL` environment variable, or
- Enable `tunnel.autoStart` in config, or
- Start tunnel manually: `cloudflared tunnel --url http://localhost:3001`

### "cloudflared not found"

Install Cloudflare Tunnel:
```bash
brew install cloudflare/cloudflare/cloudflared
```

### "Sandbox not initialized"

- Ensure E2B SDK is properly installed
- Check E2B API key if required
- Verify network connectivity

### Tool calls not working

- Verify tunnel URL is accessible
- Check tool server is running (should see `[server] Tool server running`)
- Ensure Subconscious can reach the tunnel URL

## Migration from Old Architecture

The old hardcoded workflow (Plan → Execute → Evaluate) has been replaced with Subconscious-native tool orchestration. Old components (`planner.ts`, `executor.ts`, `evaluator.ts`, `termination.ts`) are deprecated but kept for reference.

## Learn More

- **Subconscious Docs**: https://docs.subconscious.dev
- **E2B Docs**: https://e2b.dev/docs
- **Bun Docs**: https://bun.sh/docs
- **Cloudflare Tunnel**: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

## License

Apache-2.0
