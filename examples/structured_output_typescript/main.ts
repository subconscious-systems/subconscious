import { Subconscious, zodToJsonSchema } from "subconscious";
import { z } from "zod";
import dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

const client = new Subconscious({
  apiKey: process.env.SUBCONSCIOUS_API_KEY!,
});

const SentimentAnalysis = z.object({
  sentiment: z.string().describe("The overall sentiment"),
  confidence: z.number().describe("Confidence score from 0 to 1"),
  keywords: z.array(z.string()).describe("Key phrases that influenced the sentiment"),
});

type SentimentAnalysis = z.infer<typeof SentimentAnalysis>;

async function analyzeSentiment(text: string): Promise<SentimentAnalysis> {
  const run = await client.run({
    engine: "tim",
    input: {
      instructions: `Analyze the sentiment of the following text: '${text}'`,
      tools: [{ type: "platform", id: "web_search", options: {} }],
      answerFormat: zodToJsonSchema(SentimentAnalysis, "SentimentAnalysis"),
    },
    options: { awaitCompletion: true },
  });

  return run.result?.answer as unknown as SentimentAnalysis;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const userInput = await new Promise<string>((resolve) => {
    rl.question("Enter a text to analyze: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });

  const result = await analyzeSentiment(userInput);
  console.log(`Sentiment: ${result.sentiment}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Keywords: ${result.keywords}`);
}

main();
