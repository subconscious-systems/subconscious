# OpenCode + Subconscious

Run [OpenCode](https://opencode.ai) on your hosted Subconscious model.
Subconscious is registered as a custom OpenAI-compatible provider via
`OPENCODE_CONFIG_CONTENT`, which OpenCode deep-merges at startup — nothing is
written to your `~/.config/opencode`. Assumes OpenCode is already installed.

```bash
export SUBCONSCIOUS_API_KEY=your_key            # https://subconscious.dev/platform
export OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json","provider":{"subconscious":{"npm":"@ai-sdk/openai-compatible","name":"Subconscious","options":{"baseURL":"https://api.subconscious.dev/v1","apiKey":"{env:SUBCONSCIOUS_API_KEY}"},"models":{"subconscious/tim-qwen3.6-27b":{"name":"Subconscious","tools":true}}}},"model":"subconscious/subconscious/tim-qwen3.6-27b"}'
opencode
```

Swap models by editing the `models`/`model` fields in the config.
