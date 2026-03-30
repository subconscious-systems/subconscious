import { Subconscious } from "npm:subconscious";

const DEFAULT_GMAIL_TOOL_ID = "gmail_mcp";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function pickGmailTool() {
  return {
    type: "platform" as const,
    id: DEFAULT_GMAIL_TOOL_ID,
    options: {},
  };
}

export default async function(email: Email) {
  const subconscious = new Subconscious({
    apiKey: requireEnv("SUBCONSCIOUS_API_KEY"),
  });

  const tools = [pickGmailTool()];
  const trimmedText = email.text?.trim() || "(no plain text body)";
  const subject = email.subject || "(no subject)";

  const instructions = `
You are an email automation assistant running in Val Town.
Analyze and summarize the inbound email.

Inbound email:
- From: ${email.from}
- To: ${email.to.join(", ")}
- Subject: ${subject}
- Body:
${trimmedText}

If Gmail tools are available, fetch relevant context from the sender's recent emails
or related thread history before finalizing your summary.

Return:
1) one-sentence gist
2) key bullet points
3) urgency (low/medium/high)
4) recommended reply draft
`;

  const run = await subconscious.run({
    engine: "tim-gpt",
    input: {
      instructions,
      tools,
    },
    options: { awaitCompletion: true },
  });

  if (run.status !== "succeeded") {
    console.error("Subconscious run failed", run);
    return;
  }

  console.log("=== Email Summary ===");
  console.log(run.result?.answer || "No answer generated");
}
