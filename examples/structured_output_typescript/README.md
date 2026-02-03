# Structured Output Example (TypeScript)

Shows how to use Zod schemas with the Subconscious SDK to get typed responses.

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
