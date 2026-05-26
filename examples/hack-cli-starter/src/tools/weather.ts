// 👉 THIS IS THE EXAMPLE TOOL — read it, then copy it to build your own.
//
// It's a complete MCP server with one tool: `get_weather`. The agent can call it
// out of the box because it's attached at startup (see src/commands/chat.tsx),
// exactly like the built-in filesystem tool. So a fresh clone already has a custom
// tool wired in.
//
// To make YOUR tool:
//   1. Copy this file (e.g. src/tools/myThing.ts).
//   2. Change the name, description, inputSchema, and the handler body.
//   3. Add it to the list in src/tools/index.ts:  bundledToolServer("mine", "myThing")
//
// One rule: never `console.log` here — stdin/stdout IS the protocol channel, so
// printing to stdout corrupts it. Use `console.error` if you need to debug.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "weather", version: "1.0.0" });

// A tool is four things: a name, a description (the agent reads this to decide WHEN
// to use it), an input schema (Zod — this becomes the tool's arguments), and an
// async handler that does the work and returns `content`.
server.registerTool(
  "get_weather",
  {
    title: "Get weather",
    description: "Get the current temperature for a city by name.",
    inputSchema: { city: z.string().describe("a city name, e.g. 'Boston'") },
  },
  async ({ city }) => {
    // Step 1 — turn the city name into coordinates (open-meteo, free, no API key).
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    );
    const geo = (await geoRes.json()) as {
      results?: Array<{ name: string; country?: string; latitude: number; longitude: number }>;
    };
    const place = geo.results?.[0];
    if (!place) {
      return { content: [{ type: "text", text: `Couldn't find a city called "${city}".` }] };
    }

    // Step 2 — look up the current temperature for those coordinates.
    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m`,
    );
    const wx = (await wxRes.json()) as { current?: { temperature_2m: number } };

    // Step 3 — return plain text the agent can read and reason about.
    const where = place.country ? `${place.name}, ${place.country}` : place.name;
    return { content: [{ type: "text", text: `It's currently ${wx.current?.temperature_2m}°C in ${where}.` }] };
  },
);

// Connect over stdio (stdin/stdout) and start listening. That's the whole server.
await server.connect(new StdioServerTransport());
