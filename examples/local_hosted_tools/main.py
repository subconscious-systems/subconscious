"""Local-Hosted Tools Starter (image editing demo) using Subconscious tools.

Starts a local FastAPI server with image editing endpoints (curves, exposure,
contrast, saturation, blur, text overlay), exposes it via ngrok, and passes
the endpoints as authenticated function tools to a Subconscious agent.

The agent receives a natural language editing instruction and calls the
appropriate tools to edit the image.

Usage:
    python main.py "Reduce the green tones and add a gentle blur"
    python main.py --image photo.jpg "Make this warmer and increase contrast"
"""

import argparse
import os
import secrets
import shutil
import sys
import threading
import time
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from pydantic import BaseModel
from pyngrok import ngrok
from subconscious import Subconscious

load_dotenv()

# ── Configuration ────────────────────────────────────────────────────────────

WORKING_DIR = Path(__file__).parent / "workspace"
ACCESS_KEY = os.getenv(
    "LOCAL_HOSTED_TOOLS_ACCESS_KEY",
    os.getenv("IMAGE_TOOL_ACCESS_KEY", secrets.token_urlsafe(32)),
)
PORT = int(os.getenv("LOCAL_HOSTED_TOOLS_PORT", os.getenv("IMAGE_TOOL_PORT", "8100")))


# ── FastAPI Setup ────────────────────────────────────────────────────────────


async def verify_access_key(x_api_key: str = Header(...)):
    """Reject requests without a valid access key."""
    if x_api_key != ACCESS_KEY:
        raise HTTPException(status_code=401, detail="Invalid access key")


app = FastAPI(
    title="Local-Hosted Tools Starter",
    description="Image editing demo endpoints for local Subconscious tool hosting",
    dependencies=[Depends(verify_access_key)],
)


# ── Request Models ───────────────────────────────────────────────────────────


class CurvesRequest(BaseModel):
    image_path: str
    channel: str = "all"
    shadows: int = 0
    midtones: int = 0
    highlights: int = 0


class ExposureRequest(BaseModel):
    image_path: str
    stops: float = 0.0


class ContrastRequest(BaseModel):
    image_path: str
    amount: float = 0.0


class SaturationRequest(BaseModel):
    image_path: str
    amount: float = 0.0


class BlurRequest(BaseModel):
    image_path: str
    radius: float = 2.0


class AddTextRequest(BaseModel):
    image_path: str
    text: str
    x: int
    y: int
    font_size: int = 24
    color: str = "#FFFFFF"
    alignment: str = "left"


# ── Image Helpers ────────────────────────────────────────────────────────────


def _load(path: str) -> Image.Image:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    return Image.open(p).convert("RGB")


def _save(img: Image.Image, path: str) -> None:
    img.save(path, quality=95)


def _curve_lut(shadows: int, midtones: int, highlights: int) -> list[int]:
    """
    Build a 256-entry lookup table from shadow/midtone/highlight offsets.

    Each value (-100 to 100) shifts the corresponding tonal region by up to
    ±64 levels using quadratic weight functions:
      shadows   → weight peaks at 0 (black)
      midtones  → weight peaks at 128 (mid-gray)
      highlights → weight peaks at 255 (white)
    """
    lut: list[int] = []
    for i in range(256):
        t = i / 255.0
        w_s = (1 - t) ** 2
        w_m = 4 * t * (1 - t)
        w_h = t ** 2
        shift = (
            shadows / 100 * w_s + midtones / 100 * w_m + highlights / 100 * w_h
        ) * 64
        lut.append(max(0, min(255, int(i + shift))))
    return lut


def _get_font(size: int):
    for name in [
        "arial.ttf",
        "Arial.ttf",
        "DejaVuSans.ttf",
        "Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


# ── Endpoints ────────────────────────────────────────────────────────────────


@app.post("/adjust_curves")
async def adjust_curves(req: CurvesRequest):
    try:
        img = _load(req.image_path)
        lut = _curve_lut(req.shadows, req.midtones, req.highlights)
        r, g, b = img.split()

        if req.channel == "all":
            r, g, b = r.point(lut), g.point(lut), b.point(lut)
        elif req.channel in ("r", "g", "b"):
            ch = {"r": r, "g": g, "b": b}
            ch[req.channel] = ch[req.channel].point(lut)
            r, g, b = ch["r"], ch["g"], ch["b"]
        else:
            return {
                "status": "error",
                "message": f"Invalid channel '{req.channel}'. Use r, g, b, or all.",
            }

        _save(Image.merge("RGB", (r, g, b)), req.image_path)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/adjust_exposure")
async def adjust_exposure(req: ExposureRequest):
    try:
        img = _load(req.image_path)
        factor = 2.0 ** req.stops
        _save(ImageEnhance.Brightness(img).enhance(factor), req.image_path)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/adjust_contrast")
async def adjust_contrast(req: ContrastRequest):
    try:
        img = _load(req.image_path)
        factor = 1.0 + req.amount / 100.0
        _save(ImageEnhance.Contrast(img).enhance(factor), req.image_path)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/adjust_saturation")
async def adjust_saturation(req: SaturationRequest):
    try:
        img = _load(req.image_path)
        factor = 1.0 + req.amount / 100.0
        _save(ImageEnhance.Color(img).enhance(factor), req.image_path)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/blur")
async def blur_image(req: BlurRequest):
    try:
        img = _load(req.image_path)
        _save(
            img.filter(ImageFilter.GaussianBlur(radius=req.radius)),
            req.image_path,
        )
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/add_text")
async def add_text(req: AddTextRequest):
    try:
        img = _load(req.image_path)
        draw = ImageDraw.Draw(img)
        font = _get_font(req.font_size)

        color = req.color
        if color.startswith("#") and len(color) == 7:
            color = tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))

        bbox = draw.textbbox((0, 0), req.text, font=font)
        text_width = bbox[2] - bbox[0]

        x = req.x
        if req.alignment == "center":
            x = req.x - text_width // 2
        elif req.alignment == "right":
            x = req.x - text_width

        draw.text((x, req.y), req.text, fill=color, font=font)
        _save(img, req.image_path)
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Tool Definitions ─────────────────────────────────────────────────────────


def build_tools(base_url: str, image_path: str) -> list[dict]:
    """Build Subconscious function-tool definitions pointing at the ngrok URL.

    Each tool carries an ``x-api-key`` header for endpoint authentication and
    injects ``image_path`` via ``defaults`` so the model never needs to
    generate file paths.
    """
    shared: dict = {
        "type": "function",
        "method": "POST",
        "timeout": 30,
        "headers": {"x-api-key": ACCESS_KEY},
    }
    image_prop = {"type": "string", "description": "Path to the image file"}

    return [
        {
            **shared,
            "name": "adjust_curves",
            "description": (
                "Apply a curves adjustment to an image. Shift shadows, midtones, "
                "and/or highlights for a specific color channel or all channels. "
                "Values range from -100 (darken) to 100 (brighten). Use this to "
                "correct color casts — e.g. reduce green by lowering the g channel."
            ),
            "url": f"{base_url}/adjust_curves",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "channel": {
                        "type": "string",
                        "enum": ["r", "g", "b", "all"],
                        "description": "Color channel to adjust: r (red), g (green), b (blue), or all",
                    },
                    "shadows": {
                        "type": "integer",
                        "description": "Shadow region adjustment, -100 to 100",
                    },
                    "midtones": {
                        "type": "integer",
                        "description": "Midtone region adjustment, -100 to 100",
                    },
                    "highlights": {
                        "type": "integer",
                        "description": "Highlight region adjustment, -100 to 100",
                    },
                },
                "required": ["channel"],
            },
            "defaults": {"image_path": image_path},
        },
        {
            **shared,
            "name": "adjust_exposure",
            "description": (
                "Adjust the exposure (overall brightness) of an image in "
                "photographic stops. +1 doubles brightness, -1 halves it. "
                "Range: -3.0 to 3.0."
            ),
            "url": f"{base_url}/adjust_exposure",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "stops": {
                        "type": "number",
                        "description": "Exposure adjustment in stops (-3.0 to 3.0)",
                    },
                },
                "required": ["stops"],
            },
            "defaults": {"image_path": image_path},
        },
        {
            **shared,
            "name": "adjust_contrast",
            "description": (
                "Adjust image contrast. Positive values increase contrast "
                "(more separation between light and dark), negative values "
                "decrease it. Range: -100 to 100."
            ),
            "url": f"{base_url}/adjust_contrast",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "amount": {
                        "type": "number",
                        "description": "Contrast adjustment, -100 to 100",
                    },
                },
                "required": ["amount"],
            },
            "defaults": {"image_path": image_path},
        },
        {
            **shared,
            "name": "adjust_saturation",
            "description": (
                "Adjust color saturation. Positive values make colors more "
                "vivid, negative values desaturate toward grayscale. "
                "Range: -100 to 100."
            ),
            "url": f"{base_url}/adjust_saturation",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "amount": {
                        "type": "number",
                        "description": "Saturation adjustment, -100 to 100",
                    },
                },
                "required": ["amount"],
            },
            "defaults": {"image_path": image_path},
        },
        {
            **shared,
            "name": "blur",
            "description": (
                "Apply Gaussian blur to soften an image. Higher radius means "
                "stronger blur. Range: 0.1 to 50.0."
            ),
            "url": f"{base_url}/blur",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "radius": {
                        "type": "number",
                        "description": "Blur radius in pixels (0.1 to 50.0)",
                    },
                },
                "required": ["radius"],
            },
            "defaults": {"image_path": image_path},
        },
        {
            **shared,
            "name": "add_text",
            "description": (
                "Overlay text on the image at a given pixel position. "
                "Supports custom font size, hex color (e.g. #FF0000 for red), "
                "and horizontal alignment (left, center, right). "
                "x/y are pixel coordinates from the top-left corner of the image. "
                "For center/right alignment, x is the anchor point."
            ),
            "url": f"{base_url}/add_text",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_path": image_prop,
                    "text": {
                        "type": "string",
                        "description": "Text to render on the image",
                    },
                    "x": {
                        "type": "integer",
                        "description": "X position in pixels from the left edge",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y position in pixels from the top edge",
                    },
                    "font_size": {
                        "type": "integer",
                        "description": "Font size in pixels (default 24)",
                    },
                    "color": {
                        "type": "string",
                        "description": "Text color as hex, e.g. #FFFFFF for white",
                    },
                    "alignment": {
                        "type": "string",
                        "enum": ["left", "center", "right"],
                        "description": "Horizontal text alignment relative to x",
                    },
                },
                "required": ["text", "x", "y"],
            },
            "defaults": {"image_path": image_path},
        },
    ]


# ── Sample Image ─────────────────────────────────────────────────────────────


def generate_sample_image(path: Path) -> None:
    """Create a colorful test image with dominant green tones for editing demos."""
    width, height = 800, 600
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)

    for y in range(height):
        t = y / height
        r = int(40 + 60 * t)
        g = int(160 - 40 * t)
        b = int(80 + 80 * t)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    draw.ellipse([80, 60, 320, 260], fill=(200, 70, 50))
    draw.rectangle([420, 100, 680, 320], fill=(50, 190, 70))
    draw.ellipse([480, 340, 720, 520], fill=(50, 90, 210))
    draw.rectangle([120, 360, 360, 530], fill=(230, 200, 50))

    img.save(path, quality=95)
    print(f"  Generated sample image: {path}")


# ── Server ───────────────────────────────────────────────────────────────────


def start_server() -> None:
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")


# ── Main ─────────────────────────────────────────────────────────────────────


DEFAULT_PROMPT = (
    "This image has too much green. Reduce the green tones using a curves "
    "adjustment, then apply a gentle blur to soften the image."
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Starter example for locally hosted Subconscious tools",
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        default=DEFAULT_PROMPT,
        help="Editing instruction for the agent",
    )
    parser.add_argument(
        "--image",
        type=str,
        default=None,
        help="Path to an input image (omit to generate a sample)",
    )
    args = parser.parse_args()

    api_key = os.getenv("SUBCONSCIOUS_API_KEY")
    if not api_key:
        print(
            "Error: SUBCONSCIOUS_API_KEY not set.\n"
            "Get your key at https://www.subconscious.dev/platform",
            file=sys.stderr,
        )
        sys.exit(1)

    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    image_path = WORKING_DIR / "image.jpg"

    if args.image:
        src = Path(args.image)
        if not src.exists():
            print(f"Error: Image not found: {args.image}", file=sys.stderr)
            sys.exit(1)
        shutil.copy2(src, image_path)
        print(f"  Copied input image to workspace: {image_path}")
    else:
        generate_sample_image(image_path)

    print(f"  Starting local-hosted-tools server on port {PORT}...")
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    time.sleep(1.5)

    print("  Creating ngrok tunnel...")
    try:
        tunnel = ngrok.connect(PORT)
    except Exception as e:
        print(
            f"Error creating ngrok tunnel: {e}\n"
            "Make sure NGROK_AUTHTOKEN is set. Get your token at:\n"
            "  https://dashboard.ngrok.com/get-started/your-authtoken",
            file=sys.stderr,
        )
        sys.exit(1)

    base_url = tunnel.public_url
    print(f"  Tunnel live at {base_url}")
    print(f"  Access key: {ACCESS_KEY}\n")

    tools = build_tools(base_url, str(image_path))
    client = Subconscious(api_key=api_key)

    print(f'  Task: "{args.prompt}"')
    print("  Waiting for agent...\n")

    try:
        run = client.run(
            engine="tim",
            input={
                "instructions": (
                    f"{args.prompt}\n\n"
                    "Use the available image editing tools to apply the requested "
                    "edits. You may chain multiple operations — each tool modifies "
                    "the image in place. Report what you did when finished."
                ),
                "tools": tools,
            },
            options={"await_completion": True},
        )
        print(f"Agent response:\n{run.result.answer}")
    except Exception as e:
        print(f"Error during agent run: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        ngrok.disconnect(tunnel.public_url)

    print(f"\nEdited image saved to: {image_path}")


if __name__ == "__main__":
    main()
