# Local-Hosted Tools Starter

Starter example showing how to expose **locally hosted tools** to Subconscious using FastAPI + ngrok. This version uses image editing endpoints as the demo use case, but the same pattern can be reused for your own local/internal tools.

This is an educational starter, not a production-hardened app.

## How it works

1. **FastAPI server** starts locally with endpoints for curves, exposure, contrast, saturation, blur, and text overlay.
2. Every endpoint is protected by an `x-api-key` header — a random key is generated at startup (or you can set `LOCAL_HOSTED_TOOLS_ACCESS_KEY`).
3. **ngrok** creates a public tunnel so Subconscious can reach the local server.
4. The script builds [Subconscious function tools](https://docs.subconscious.dev/core-concepts/tools) with:
   - `headers` — passes the access key so only the agent can call the endpoints
   - `defaults` — injects the local image path so the model never needs to generate file paths
5. A **Subconscious agent run** is created with the tools and your editing prompt. The agent calls the tools as needed and reports what it did.

## Setup

```bash
pip install .
```

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

| Variable | Where to get it |
|---|---|
| `SUBCONSCIOUS_API_KEY` | [subconscious.dev/platform](https://subconscious.dev/platform) |
| `NGROK_AUTHTOKEN` | [dashboard.ngrok.com](https://dashboard.ngrok.com/get-started/your-authtoken) |

## Run

```bash
# Use the default prompt (reduce green + blur) with a generated sample image
python main.py

# Custom prompt
python main.py "Increase contrast and add the text 'Hello' in white at the center"

# Bring your own image
python main.py --image photo.jpg "Make this image warmer and boost saturation"
```

The edited image is saved to `workspace/image.jpg`.

## Available tools

| Endpoint | What it does | Key parameters |
|---|---|---|
| `/adjust_curves` | Per-channel curves (shadows / midtones / highlights) | `channel` (r/g/b/all), `shadows`, `midtones`, `highlights` |
| `/adjust_exposure` | Brightness in photographic stops | `stops` (-3.0 to 3.0) |
| `/adjust_contrast` | Contrast enhancement | `amount` (-100 to 100) |
| `/adjust_saturation` | Color saturation | `amount` (-100 to 100) |
| `/blur` | Gaussian blur | `radius` (0.1 to 50.0) |
| `/add_text` | Text overlay | `text`, `x`, `y`, `font_size`, `color`, `alignment` |

All endpoints return `{"status": "success"}` or `{"status": "error", "message": "..."}`.

## Example prompts

- _"This image has too much green. Reduce the green channel."_ — agent calls `adjust_curves` on the `g` channel
- _"Blur this picture."_ — agent calls `blur`
- _"Make this warmer, increase contrast, and add 'DRAFT' in red at the top center."_ — agent chains `adjust_curves` + `adjust_contrast` + `add_text`

## Authentication flow

```
┌──────────┐   headers: {"x-api-key": KEY}   ┌────────────┐
│  Subcon-  │ ──────────────────────────────►  │  FastAPI    │
│  scious   │   POST /adjust_curves {...}      │  Server     │
│  Agent    │ ◄──────────────────────────────  │  (ngrok)    │
└──────────┘   {"status": "success"}           └────────────┘
```

The access key is set in each tool's `headers` dict so Subconscious sends it automatically. The FastAPI app validates it via a global dependency before any endpoint runs.
