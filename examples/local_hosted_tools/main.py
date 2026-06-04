"""Local-Hosted Tools — Image Editing Demo (client-side ReAct loop).

Defines image editing tools as plain local Python functions, then runs a
client-side ReAct agent loop against the Subconscious API to apply a
natural-language editing instruction to an image.

No HTTP server, no tunnel, no ngrok — the tools run directly in this process.

Usage:
    python main.py
    python main.py "Reduce the green tones and add a gentle blur"
    python main.py --image photo.jpg "Make this warmer and increase contrast"
"""

import argparse
import logging
import os
import shutil
import sys
from pathlib import Path

import openai
from dotenv import load_dotenv
from PIL import Image, ImageDraw

from agent import run_agent

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1"
WORKING_DIR = Path(__file__).parent / "workspace"
DEFAULT_PROMPT = (
    "This image has too much green. Reduce the green tones using a curves "
    "adjustment, then apply a gentle blur to soften the image."
)


# ---------------------------------------------------------------------------
# Sample image generator
# ---------------------------------------------------------------------------


def generate_sample_image(path: Path) -> None:
    """Create a colourful test image with dominant green tones for editing demos."""
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
    logger.info("Generated sample image: %s", path)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Image editing demo: runs a client-side ReAct agent against the "
            "Subconscious API to edit an image using local Python tools."
        ),
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        default=DEFAULT_PROMPT,
        help="Natural-language editing instruction for the agent",
    )
    parser.add_argument(
        "--image",
        type=str,
        default=None,
        help="Path to an input image (omit to generate a sample)",
    )
    args = parser.parse_args()

    # Validate required environment variable.
    api_key = os.getenv("SUBCONSCIOUS_API_KEY")
    if not api_key:
        print(
            "Error: SUBCONSCIOUS_API_KEY is not set.\n"
            "Get your key at https://www.subconscious.dev/platform",
            file=sys.stderr,
        )
        sys.exit(1)

    # Prepare workspace and image.
    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    image_path = WORKING_DIR / "image.jpg"

    if args.image:
        src = Path(args.image)
        if not src.exists():
            print(f"Error: Image not found: {args.image}", file=sys.stderr)
            sys.exit(1)
        shutil.copy2(src, image_path)
        logger.info("Copied input image to workspace: %s", image_path)
    else:
        generate_sample_image(image_path)

    # Build the OpenAI-compatible client pointed at Subconscious.
    client = openai.OpenAI(
        api_key=api_key,
        base_url=SUBCONSCIOUS_BASE_URL,
    )

    print(f'\nTask: "{args.prompt}"')
    print("Running agent...\n")

    try:
        answer = run_agent(
            client=client,
            prompt=args.prompt,
            image_path=str(image_path.resolve()),
        )
    except RuntimeError as exc:
        print(f"\nAgent error: {exc}", file=sys.stderr)
        sys.exit(1)
    except openai.APIError as exc:
        print(f"\nAPI error: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\nAgent response:\n{answer}")
    print(f"\nEdited image saved to: {image_path}")


if __name__ == "__main__":
    main()
