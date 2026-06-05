"""Image-editing agent — a client-side tool loop over the Subconscious API.

The image tools are plain local Python functions (see tools.py). We hand them to
the model as OpenAI function tools; when it calls one, we run it locally and feed
the result back, looping until the model gives a final answer. No server, no tunnel.

    python main.py                                   # edits a generated sample image
    python main.py "Boost contrast and add a blur"   # custom instruction
    python main.py --image photo.jpg "Make it warmer"
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageDraw

from tools import OPENAI_TOOL_SPECS, TOOL_FUNCTIONS

load_dotenv()

BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"
MAX_STEPS = 12
WORKSPACE = Path(__file__).parent / "workspace"
DEFAULT_PROMPT = "Reduce the green tones with a curves adjustment, then add a gentle blur."


def make_sample_image(path: Path) -> None:
    """Draw a colourful, green-heavy test image so the demo runs with no input."""
    img = Image.new("RGB", (800, 600))
    draw = ImageDraw.Draw(img)
    for y in range(600):
        t = y / 600
        draw.line([(0, y), (800, y)], fill=(int(40 + 60 * t), int(160 - 40 * t), int(80 + 80 * t)))
    draw.ellipse([80, 60, 320, 260], fill=(200, 70, 50))
    draw.rectangle([420, 100, 680, 320], fill=(50, 190, 70))
    img.save(path, quality=95)


def call_tool(name: str, arguments_json: str) -> str:
    """Run one tool call and return its JSON result. Bad args / failures come back
    as a JSON error so the model can see them and recover — we never crash the loop."""
    fn = TOOL_FUNCTIONS.get(name)
    if fn is None:
        return json.dumps({"status": "error", "message": f"unknown tool {name!r}"})
    try:
        return json.dumps(fn(**json.loads(arguments_json)))
    except Exception as exc:
        return json.dumps({"status": "error", "message": str(exc)})


def run_agent(client: OpenAI, prompt: str, image_path: str) -> str:
    """model -> tool calls -> results -> ... until the model replies with no tool calls."""
    messages: list[Any] = [
        {
            "role": "system",
            "content": (
                "You are an image editor. Edit the image using the tools provided. "
                f"Pass this exact path as image_path to every tool call: {image_path}. "
                "When the edits are done, reply with a short summary and no tool calls."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    for _ in range(MAX_STEPS):
        msg = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=OPENAI_TOOL_SPECS,  # type: ignore[arg-type]
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        ).choices[0].message

        if not msg.tool_calls:
            return msg.content or ""

        # Record the assistant turn (must include tool_calls before the tool results).
        messages.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        })
        for tc in msg.tool_calls:
            print(f"  [tool] {tc.function.name}({tc.function.arguments})")
            result = call_tool(tc.function.name, tc.function.arguments)
            print(f"  [result] {result}")
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "Stopped: reached the step limit without finishing."


def main() -> None:
    parser = argparse.ArgumentParser(description="Edit an image with a Subconscious agent.")
    parser.add_argument("prompt", nargs="?", default=DEFAULT_PROMPT, help="editing instruction")
    parser.add_argument("--image", help="input image path (omit to generate a sample)")
    args = parser.parse_args()

    api_key = os.getenv("SUBCONSCIOUS_API_KEY")
    if not api_key:
        sys.exit("SUBCONSCIOUS_API_KEY is not set — get one at https://subconscious.dev/platform")

    WORKSPACE.mkdir(exist_ok=True)
    image_path = WORKSPACE / "image.jpg"
    if args.image:
        if not Path(args.image).exists():
            sys.exit(f"Image not found: {args.image}")
        shutil.copy2(args.image, image_path)
    else:
        make_sample_image(image_path)

    client = OpenAI(base_url=BASE_URL, api_key=api_key)
    print(f'Task: "{args.prompt}"\n')
    answer = run_agent(client, args.prompt, str(image_path.resolve()))
    print(f"\n{answer}\nSaved: {image_path}")


if __name__ == "__main__":
    main()
