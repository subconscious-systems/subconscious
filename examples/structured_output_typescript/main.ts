// Structured output with Subconscious.
//
// Subconscious speaks the OpenAI Chat Completions protocol, so we point the
// official `openai` SDK at its base URL. To get a typed response, we pass a JSON
// schema via `response_format` and validate the reply with a Zod schema.

import "dotenv/config";
import * as readline from "node:readline/promises";
import OpenAI from "openai";
import { z } from "zod";

const BASE_URL = "https://api.subconscious.dev/v1";
const MODEL = "subconscious/tim-qwen3.6-27b";

const apiKey = process.env.SUBCONSCIOUS_API_KEY;
if (!apiKey) {
  throw new Error("SUBCONSCIOUS_API_KEY is not set. Add it to your environment or a .env file.");
}

const client = new OpenAI({ baseURL: BASE_URL, apiKey });

const SentimentAnalysis = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number(),
  keywords: z.array(z.string()),
});

type SentimentAnalysis = z.infer<typeof SentimentAnalysis>;

async function analyzeSentiment(text: string): Promise<SentimentAnalysis> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "user", content: `Analyze the sentiment of the following text: ${JSON.stringify(text)}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "SentimentAnalysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            sentiment: {
              type: "string",
              enum: ["positive", "negative", "neutral"],
              description: "Overall sentiment of the text",
            },
            confidence: { type: "number", description: "Confidence score from 0 to 1" },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Key phrases that drove the sentiment",
            },
          },
          required: ["sentiment", "confidence", "keywords"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return SentimentAnalysis.parse(JSON.parse(content));
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const userInput = await rl.question("Enter a text to analyze: ");
  rl.close();

  const result = await analyzeSentiment(userInput);
  console.log(`Sentiment:  ${result.sentiment}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Keywords:   ${result.keywords.join(", ")}`);
}

main();
