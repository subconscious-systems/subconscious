# Structured Output Example (Python)

Shows how to get typed responses from Subconscious. The API speaks the OpenAI
Chat Completions protocol, so we point the official `openai` SDK at
`https://api.subconscious.dev/v1`, pass a JSON schema via `response_format`, and
validate the reply with a Pydantic model.

Thinking is disabled on the request (`enable_thinking: false`) so the model
returns clean JSON with no prose preamble — a requirement for reliable structured
output parsing.

## Prerequisites

- Python 3.9+
- A Subconscious API key — get one at <https://www.subconscious.dev/platform/api-keys>

## Setup

```bash
pip install .
```

Create a `.env` file:

```
SUBCONSCIOUS_API_KEY=your_key
```

## Run

```bash
python main.py
```

Enter some text when prompted. The model will analyze the sentiment and return a
structured response validated by a Pydantic model.

## Expected Output

```
Enter a text to analyze: The new product launch went incredibly well!
Sentiment:  positive
Confidence: 0.97
Keywords:   new product launch, incredibly well
```
