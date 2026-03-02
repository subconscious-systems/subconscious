/**
 * Self-hosted tool: Calculator
 *
 * When the agent decides to use this tool, Subconscious POSTs here
 * with the parameters defined in lib/tools.ts.
 *
 * Creating your own tool is the same pattern:
 *   1. Create app/api/tools/<name>/route.ts (accept POST, return JSON)
 *   2. Define the tool schema in lib/tools.ts → getSelfHostedTools()
 *   3. Add it to lib/tool-registry.ts so the sidebar shows it
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED = /^[0-9+\-*/().,%\s\^e]+$/i;

export async function POST(req: NextRequest) {
  try {
    const { expression } = await req.json();

    if (!expression || typeof expression !== "string") {
      return NextResponse.json(
        { error: "expression is required" },
        { status: 400 },
      );
    }

    if (!ALLOWED.test(expression)) {
      return NextResponse.json(
        { error: "Expression contains invalid characters" },
        { status: 400 },
      );
    }

    const normalized = expression.replace(/\^/g, "**");
    const result = new Function(`"use strict"; return (${normalized})`)();

    if (typeof result !== "number" || !isFinite(result)) {
      return NextResponse.json(
        { error: "Expression did not produce a finite number" },
        { status: 400 },
      );
    }

    return NextResponse.json({ result });
  } catch {
    return NextResponse.json(
      { error: "Failed to evaluate expression" },
      { status: 400 },
    );
  }
}
