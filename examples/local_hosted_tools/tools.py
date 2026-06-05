"""Image editing tools — pure local Python functions.

Each function takes explicit keyword arguments, validates its inputs, and
returns a result dict ``{"status": "success"}`` or
``{"status": "error", "message": "..."}``.  No mutation of shared state.

The ``TOOL_REGISTRY`` list exposes the JSON-schema descriptions that the
agent loop injects into the system prompt.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont



# ---------------------------------------------------------------------------
# Image I/O helpers (immutable: load returns a new Image object)
# ---------------------------------------------------------------------------


def _load_image(path: str) -> Image.Image:
    """Load an image from *path* and convert it to RGB.

    Raises ``FileNotFoundError`` with a clear message if the file is absent.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    return Image.open(p).convert("RGB")


def _save_image(img: Image.Image, path: str) -> None:
    """Save *img* to *path* at high quality."""
    img.save(path, quality=95)


def _curve_lut(shadows: int, midtones: int, highlights: int) -> list[int]:
    """Return a 256-entry lookup table from shadow/midtone/highlight offsets.

    Values (-100 to 100) shift the corresponding tonal region by up to ±64
    levels using quadratic weight functions:
      shadows    → weight peaks at 0   (black)
      midtones   → weight peaks at 128 (mid-grey)
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


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Return the best available font at *size*, falling back to the default."""
    candidates = [
        "arial.ttf",
        "Arial.ttf",
        "DejaVuSans.ttf",
        "Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


# ---------------------------------------------------------------------------
# Tool functions
# ---------------------------------------------------------------------------


def adjust_curves(
    image_path: str,
    channel: str = "all",
    shadows: int = 0,
    midtones: int = 0,
    highlights: int = 0,
) -> dict[str, Any]:
    """Apply a curves adjustment to the image.

    *channel* must be one of ``r``, ``g``, ``b``, or ``all``.
    *shadows*, *midtones*, *highlights* range from -100 to 100.
    """
    valid_channels = {"r", "g", "b", "all"}
    if channel not in valid_channels:
        return {
            "status": "error",
            "message": f"Invalid channel '{channel}'. Must be one of {sorted(valid_channels)}.",
        }
    for name, val in (("shadows", shadows), ("midtones", midtones), ("highlights", highlights)):
        if not (-100 <= val <= 100):
            return {"status": "error", "message": f"'{name}' must be between -100 and 100, got {val}."}

    try:
        img = _load_image(image_path)
        lut = _curve_lut(shadows, midtones, highlights)
        r, g, b = img.split()

        if channel == "all":
            new_r, new_g, new_b = r.point(lut), g.point(lut), b.point(lut)
        else:
            ch = {"r": r, "g": g, "b": b}
            ch[channel] = ch[channel].point(lut)
            new_r, new_g, new_b = ch["r"], ch["g"], ch["b"]

        result = Image.merge("RGB", (new_r, new_g, new_b))
        _save_image(result, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def adjust_exposure(image_path: str, stops: float = 0.0) -> dict[str, Any]:
    """Adjust exposure (brightness) in photographic stops.

    +1 doubles brightness, -1 halves it.  Range: -3.0 to 3.0.
    """
    if not (-3.0 <= stops <= 3.0):
        return {"status": "error", "message": f"'stops' must be between -3.0 and 3.0, got {stops}."}
    try:
        img = _load_image(image_path)
        factor = 2.0 ** stops
        result = ImageEnhance.Brightness(img).enhance(factor)
        _save_image(result, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def adjust_contrast(image_path: str, amount: float = 0.0) -> dict[str, Any]:
    """Adjust image contrast.

    Positive values increase contrast; negative values flatten it.
    Range: -100 to 100.
    """
    if not (-100.0 <= amount <= 100.0):
        return {"status": "error", "message": f"'amount' must be between -100 and 100, got {amount}."}
    try:
        img = _load_image(image_path)
        factor = 1.0 + amount / 100.0
        result = ImageEnhance.Contrast(img).enhance(factor)
        _save_image(result, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def adjust_saturation(image_path: str, amount: float = 0.0) -> dict[str, Any]:
    """Adjust colour saturation.

    Positive values make colours more vivid; negative values desaturate.
    Range: -100 to 100.
    """
    if not (-100.0 <= amount <= 100.0):
        return {"status": "error", "message": f"'amount' must be between -100 and 100, got {amount}."}
    try:
        img = _load_image(image_path)
        factor = 1.0 + amount / 100.0
        result = ImageEnhance.Color(img).enhance(factor)
        _save_image(result, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def blur(image_path: str, radius: float = 2.0) -> dict[str, Any]:
    """Apply Gaussian blur.  *radius* range: 0.1 to 50.0."""
    if not (0.1 <= radius <= 50.0):
        return {"status": "error", "message": f"'radius' must be between 0.1 and 50.0, got {radius}."}
    try:
        img = _load_image(image_path)
        result = img.filter(ImageFilter.GaussianBlur(radius=radius))
        _save_image(result, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def add_text(
    image_path: str,
    text: str,
    x: int,
    y: int,
    font_size: int = 24,
    color: str = "#FFFFFF",
    alignment: str = "left",
) -> dict[str, Any]:
    """Overlay *text* on the image at pixel coordinates (*x*, *y*).

    *color* is a hex string e.g. ``#FF0000``.
    *alignment* is ``left``, ``center``, or ``right`` relative to *x*.
    """
    valid_alignments = {"left", "center", "right"}
    if alignment not in valid_alignments:
        return {
            "status": "error",
            "message": f"'alignment' must be one of {sorted(valid_alignments)}, got '{alignment}'.",
        }
    if not text:
        return {"status": "error", "message": "'text' must not be empty."}

    try:
        img = _load_image(image_path)
        draw = ImageDraw.Draw(img)
        font = _get_font(font_size)

        fill: str | tuple[int, int, int] = color
        if color.startswith("#") and len(color) == 7:
            fill = (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))

        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]

        draw_x = x
        if alignment == "center":
            draw_x = x - text_width // 2
        elif alignment == "right":
            draw_x = x - text_width

        draw.text((draw_x, y), text, fill=fill, font=font)
        _save_image(img, image_path)
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


# ---------------------------------------------------------------------------
# Tool registry — functions + JSON-schema descriptions for the system prompt
# ---------------------------------------------------------------------------

#: Maps tool name → callable.  The agent loop uses this to dispatch calls.
TOOL_FUNCTIONS: dict[str, Callable[..., dict[str, Any]]] = {
    "adjust_curves": adjust_curves,
    "adjust_exposure": adjust_exposure,
    "adjust_contrast": adjust_contrast,
    "adjust_saturation": adjust_saturation,
    "blur": blur,
    "add_text": add_text,
}

#: Raw function definitions (name, description, parameters).
#: Used to build ``OPENAI_TOOL_SPECS`` below.
TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "adjust_curves",
        "description": (
            "Apply a curves adjustment to an image. Shift shadows, midtones, and/or "
            "highlights for a specific colour channel or all channels. Values range "
            "from -100 (darken) to 100 (brighten). Use this to correct colour casts "
            "— e.g. reduce green by setting channel='g' with a negative midtones value."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "channel": {
                    "type": "string",
                    "enum": ["r", "g", "b", "all"],
                    "description": "Colour channel: r, g, b, or all",
                },
                "shadows": {"type": "integer", "description": "Shadow adjustment -100 to 100"},
                "midtones": {"type": "integer", "description": "Midtone adjustment -100 to 100"},
                "highlights": {"type": "integer", "description": "Highlight adjustment -100 to 100"},
            },
            "required": ["image_path", "channel"],
        },
    },
    {
        "name": "adjust_exposure",
        "description": (
            "Adjust exposure (overall brightness) in photographic stops. "
            "+1 doubles brightness, -1 halves it. Range: -3.0 to 3.0."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "stops": {"type": "number", "description": "Exposure adjustment in stops (-3.0 to 3.0)"},
            },
            "required": ["image_path", "stops"],
        },
    },
    {
        "name": "adjust_contrast",
        "description": (
            "Adjust image contrast. Positive values increase contrast "
            "(more separation between light and dark), negative values reduce it. "
            "Range: -100 to 100."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "amount": {"type": "number", "description": "Contrast adjustment -100 to 100"},
            },
            "required": ["image_path", "amount"],
        },
    },
    {
        "name": "adjust_saturation",
        "description": (
            "Adjust colour saturation. Positive values make colours more vivid, "
            "negative values desaturate toward greyscale. Range: -100 to 100."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "amount": {"type": "number", "description": "Saturation adjustment -100 to 100"},
            },
            "required": ["image_path", "amount"],
        },
    },
    {
        "name": "blur",
        "description": (
            "Apply Gaussian blur to soften an image. "
            "Higher radius means stronger blur. Range: 0.1 to 50.0."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "radius": {"type": "number", "description": "Blur radius in pixels (0.1 to 50.0)"},
            },
            "required": ["image_path", "radius"],
        },
    },
    {
        "name": "add_text",
        "description": (
            "Overlay text on the image at a given pixel position. "
            "Supports custom font size, hex colour (e.g. #FF0000 for red), "
            "and horizontal alignment (left, center, right). "
            "x/y are pixel coordinates from the top-left corner."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_path": {"type": "string", "description": "Absolute path to the image file"},
                "text": {"type": "string", "description": "Text to render on the image"},
                "x": {"type": "integer", "description": "X position in pixels from the left edge"},
                "y": {"type": "integer", "description": "Y position in pixels from the top edge"},
                "font_size": {"type": "integer", "description": "Font size in pixels (default 24)"},
                "color": {"type": "string", "description": "Text colour as hex, e.g. #FFFFFF"},
                "alignment": {
                    "type": "string",
                    "enum": ["left", "center", "right"],
                    "description": "Horizontal text alignment relative to x",
                },
            },
            "required": ["image_path", "text", "x", "y"],
        },
    },
]

#: Native OpenAI function-tool specs consumed by the chat-completions ``tools`` param.
#: Each entry wraps a TOOL_SCHEMAS entry in the ``{"type":"function","function":{...}}``
#: envelope required by the OpenAI API.
OPENAI_TOOL_SPECS: list[dict[str, Any]] = [
    {"type": "function", "function": schema}
    for schema in TOOL_SCHEMAS
]
