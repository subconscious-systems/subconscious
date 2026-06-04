# Structured output with Subconscious.
#
# Subconscious speaks the OpenAI Chat Completions protocol, so we point the
# official `openai` SDK at its base URL. To get a typed response, we pass a JSON
# schema via `response_format` and validate the reply with a Pydantic model.

import os

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

load_dotenv()

BASE_URL = "https://api.subconscious.dev/v1"
MODEL = "subconscious/tim-qwen3.6-27b"

client = OpenAI(
    base_url=BASE_URL,
    api_key=os.environ["SUBCONSCIOUS_API_KEY"],  # raises KeyError if unset
)


class SentimentAnalysis(BaseModel):
    sentiment: str
    confidence: float
    keywords: list[str]


# JSON Schema the model must fill in. `strict` + `additionalProperties: False`
# keep the reply locked to exactly these fields.
SENTIMENT_SCHEMA: dict[str, object] = {
    "type": "object",
    "title": "SentimentAnalysis",
    "properties": {
        "sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "neutral"],
            "description": "Overall sentiment of the text",
        },
        "confidence": {
            "type": "number",
            "description": "Confidence score from 0 to 1",
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Key phrases that drove the sentiment",
        },
    },
    "required": ["sentiment", "confidence", "keywords"],
    "additionalProperties": False,
}


def analyze_sentiment(text: str) -> SentimentAnalysis:
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": f"Analyze the sentiment of the following text: {text!r}",
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "SentimentAnalysis",
                "strict": True,
                "schema": SENTIMENT_SCHEMA,
            },
        },
    )

    content = completion.choices[0].message.content or ""
    try:
        return SentimentAnalysis.model_validate_json(content)
    except ValidationError as err:
        raise RuntimeError(f"Model returned data that did not match the schema:\n{content}") from err


def main() -> None:
    text = input("Enter a text to analyze: ")
    result = analyze_sentiment(text)
    print(f"Sentiment:  {result.sentiment}")
    print(f"Confidence: {result.confidence}")
    print(f"Keywords:   {', '.join(result.keywords)}")


if __name__ == "__main__":
    main()
