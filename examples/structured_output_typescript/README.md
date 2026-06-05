# Structured Output Example (TypeScript)

Shows how to get typed responses from Subconscious. The API speaks the OpenAI
Chat Completions protocol, so we point the official `openai` SDK at
`https://api.subconscious.dev/v1`, pass a JSON schema via `response_format`, and
validate the reply with a Zod schema.

## Prerequisites

- Node.js 18+
- A Subconscious API key — get one at https://www.subconscious.dev/platform/api-keys

## Setup

```bash
npm install
export SUBCONSCIOUS_API_KEY=your_key
```

Or copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env
# edit .env: SUBCONSCIOUS_API_KEY=your_key
```

## Run

```bash
npx tsx main.ts
```

Enter some text when prompted. The model analyzes the sentiment and returns a
structured JSON response validated against a Zod schema.

## Expected output

```
Enter a text to analyze: The product works great and shipping was fast!
Sentiment:  positive
Confidence: 0.97
Keywords:   works great, shipping, fast
```
