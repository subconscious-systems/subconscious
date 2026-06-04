# Local Image Editing Tools

An image editing demo that runs a **client-side ReAct agent loop** against the
Subconscious API.  Six image-editing operations (curves, exposure, contrast,
saturation, blur, text overlay) are implemented as plain local Python functions
— no HTTP server, no tunnel, no ngrok needed.

This is an educational starter, not a production-hardened app.

## How it works

1. `tools.py` defines six image-editing functions, their JSON-schema
   descriptions (`TOOL_SCHEMAS`), and a ready-made `OPENAI_TOOL_SPECS` list
   in the standard `{"type":"function","function":{...}}` shape.
2. `agent.py` runs a native OpenAI function-tool loop against the Subconscious
   endpoint (which supports `tools` natively — no workaround needed):
   - Sends `messages` + `tools=OPENAI_TOOL_SPECS` to
     `subconscious/tim-qwen3.6-27b`.
   - If the response has `tool_calls`, appends the assistant message (with
     `tool_calls`), executes each function locally, appends a `role: "tool"`
     result message per call, and loops.
   - When no `tool_calls` are present the model's `content` is the final answer.
   - A max-steps guard (default 12) prevents infinite loops.
3. `main.py` is the thin CLI entry point: validates the API key, prepares the
   workspace image, wires up the OpenAI client, and prints the agent's
   response.

## Setup

```bash
pip install .
```

Copy the example env file and fill in your key:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `SUBCONSCIOUS_API_KEY` | [subconscious.dev/platform](https://subconscious.dev/platform) |

## Run

```bash
# Default prompt (reduce green + blur) with a generated sample image
python main.py

# Custom prompt
python main.py "Increase contrast and add the text 'Hello' in white at the center"

# Bring your own image
python main.py --image photo.jpg "Make this image warmer and boost saturation"
```

The edited image is saved to `workspace/image.jpg`.

## Available tools

| Tool | What it does | Key parameters |
|---|---|---|
| `adjust_curves` | Per-channel curves (shadows / midtones / highlights) | `channel` (r/g/b/all), `shadows`, `midtones`, `highlights` |
| `adjust_exposure` | Brightness in photographic stops | `stops` (-3.0 to 3.0) |
| `adjust_contrast` | Contrast enhancement | `amount` (-100 to 100) |
| `adjust_saturation` | Colour saturation | `amount` (-100 to 100) |
| `blur` | Gaussian blur | `radius` (0.1 to 50.0) |
| `add_text` | Text overlay | `text`, `x`, `y`, `font_size`, `color`, `alignment` |

All tools return `{"status": "success"}` or `{"status": "error", "message": "..."}`.

## Example prompts

- _"This image has too much green. Reduce the green channel."_ — agent calls `adjust_curves` on the `g` channel
- _"Blur this picture."_ — agent calls `blur`
- _"Make this warmer, increase contrast, and add 'DRAFT' in red at the top center."_ — agent chains `adjust_curves` + `adjust_contrast` + `add_text`
