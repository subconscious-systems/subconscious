# Structured Output Example (TypeScript)

Shows how to get typed responses from Subconscious. The API speaks the OpenAI
Chat Completions protocol, so we point the official `openai` SDK at
`https://api.subconscious.dev/v1`, pass a JSON schema via `response_format`, and
validate the reply with a Zod schema.

## Setup

```bash
npm install
```

Create a `.env` file:

```
SUBCONSCIOUS_API_KEY=your-api-key
```

## Run

```bash
npx tsx main.ts
```

Enter some text when prompted. The agent will analyze the sentiment and return a structured response with sentiment, confidence, and keywords.
