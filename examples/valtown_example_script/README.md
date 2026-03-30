# Val Town Example Script: Email Summarizer (Subconscious + Gmail MCP)

Email-triggered automation for [Val Town](https://www.val.town/) that:

1. receives an inbound email via an Email trigger,
2. calls Subconscious, and
3. returns a concise summary plus a suggested reply.

## What this template includes

- `emailSummary.val.ts`: the Val Town email handler
- `package.json`: metadata for `create-subconscious-app`

## Setup

### 1) Create a new Email Val

In Val Town, create a new val and choose the **Email** trigger.

### 2) Paste the template

Copy the contents of `emailSummary.val.ts` into your Email val.

### 3) Configure environment variables in Val Town

Required:

- `SUBCONSCIOUS_API_KEY` = your Subconscious API key

### 4) Enable Gmail MCP on Subconscious

In the Subconscious platform tools page, enable the `gmail_mcp` tool for the account tied to the API key above.  
This template hardcodes the tool slug and does not require any Gmail MCP env vars.

### 5) Send a test email

Use the val's `@valtown.email` address and inspect the Val logs for:

- one-sentence gist
- key bullets
- urgency level
- recommended reply draft

## Notes

- Val Town Email triggers provide an `Email` object with `from`, `subject`, `text`, and attachments.
- This template logs the final summary. You can extend it to auto-forward summaries to Slack, Discord, or another inbox.

## Docs

- [Val Town Email triggers](https://docs.val.town/vals/email.md)
- [Val Town Gmail guide](https://docs.val.town/guides/gmail.md)
- [Subconscious tools](https://docs.subconscious.dev/core-concepts/tools.md)
