/**
 * Self-hosted tool: WebReader
 *
 * Fetches a URL and returns cleaned text content. The agent uses
 * this to read specific web pages when web_search isn't enough.
 */

import { NextRequest, NextResponse } from "next/server";

const MAX_LENGTH = 8000;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400 },
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL" },
        { status: 400 },
      );
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json(
        { error: "Only http and https URLs are supported" },
        { status: 400 },
      );
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "SubconsciousAgent/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Fetch failed with status ${res.status}` },
        { status: 502 },
      );
    }

    const html = await res.text();

    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    const text = stripped.slice(0, MAX_LENGTH);
    const title =
      html
        .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.trim() ?? "";

    return NextResponse.json({
      url: parsed.href,
      title,
      content: text,
      truncated: stripped.length > MAX_LENGTH,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
