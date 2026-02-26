# Structured Output Example (Python)

Shows how to use Pydantic models with the Subconscious SDK to get typed responses.

## Setup

```bash
pip install .
```

Create a `.env` file:

```
SUBCONSCIOUS_API_KEY=your-api-key
```

## Run

```bash
python main.py
```

Enter some text when prompted. The agent will analyze the sentiment and return a structured response with sentiment, confidence, and keywords.
