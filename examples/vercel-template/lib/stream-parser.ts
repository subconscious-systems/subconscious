/**
 * Stream parser for Subconscious agent responses.
 *
 * When you call client.stream(), Subconscious sends SSE events:
 *   { type: "delta", content: "..." }
 *
 * The content chunks concatenate into a JSON object like:
 *
 *   {
 *     "reasoning": [{
 *       "title": "Research the topic",
 *       "thought": "I should look into...",
 *       "tooluse": [{
 *         "tool_name": "web_search",
 *         "parameters": { "query": "..." },
 *         "tool_result": { ... }
 *       }],
 *       "subtasks": [{ ...nested reasoning steps... }],
 *       "conclusion": "Based on my research..."
 *     }],
 *     "answer": "The final response."
 *   }
 *
 * This module parses that response incrementally:
 *   - During streaming (JSON incomplete): regex-based flat extraction
 *   - After streaming (JSON complete): full tree parse with depth
 */

// ─── Types ───────────────────────────────────────────────────────

export interface StreamState {
  steps: ReasoningStep[];
  toolInvocations: ParsedToolUse[];
  answer: string;
}

export interface ReasoningStep {
  title: string;
  thought: string;
  conclusion: string;
  toolUses: ParsedToolUse[];
  status: "thinking" | "tool-use" | "complete";
  depth: number;
}

export interface ParsedToolUse {
  toolName: string;
  parameters: string;
  hasResult: boolean;
  result: string;
}

// ─── Main entry point ────────────────────────────────────────────

export function parseStreamContent(content: string): StreamState {
  const toolInvocations = extractToolUses(content);

  const tree = tryParseReasoningTree(content);
  if (tree) {
    return { steps: tree.steps, toolInvocations, answer: tree.answer };
  }

  return {
    steps: extractStepsFlat(content, toolInvocations),
    toolInvocations,
    answer: extractJsonStringField(content, "answer") ?? "",
  };
}

/** Format tool parameters for display, stripping the "objective" key. */
export function formatToolParams(raw: string): string {
  try {
    return Object.entries(JSON.parse(raw))
      .filter(([k]) => k !== "objective")
      .map(
        ([k, v]) =>
          `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
      )
      .join("\n");
  } catch {
    return raw;
  }
}

/** Format tool result for display. */
export function formatToolResult(raw: string): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj)
      .map(
        ([k, v]) =>
          `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
      )
      .join("\n");
  } catch {
    return raw;
  }
}

// ─── Tree-based parsing (complete JSON) ──────────────────────────
// Once the full JSON has arrived, parse the actual reasoning tree
// with nested subtasks and proper depth tracking.

function tryParseReasoningTree(
  content: string,
): { steps: ReasoningStep[]; answer: string } | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const reasoning = parsed?.reasoning;
  if (!reasoning) return null;

  const nodes = Array.isArray(reasoning) ? reasoning : [reasoning];
  const steps: ReasoningStep[] = [];
  flattenNodes(nodes, steps, 0);

  return steps.length > 0
    ? { steps, answer: (parsed.answer as string) ?? "" }
    : null;
}

/** Recursively flatten the Subconscious reasoning tree into a flat step list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenNodes(nodes: any[], out: ReasoningStep[], depth: number): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (!node.title && !node.thought) continue;

    const toolUses = extractNodeToolUses(node);
    const hasConclusion = !!node.conclusion;

    out.push({
      title: node.title || `Step ${out.length + 1}`,
      thought: node.thought || "",
      conclusion: node.conclusion || "",
      toolUses,
      status: hasConclusion
        ? "complete"
        : toolUses.some((t) => !t.hasResult)
          ? "tool-use"
          : "thinking",
      depth,
    });

    if (Array.isArray(node.subtasks) && node.subtasks.length > 0) {
      flattenNodes(node.subtasks, out, depth + 1);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNodeToolUses(node: any): ParsedToolUse[] {
  const raw = node.tooluse;
  if (!raw) return [];

  const list = Array.isArray(raw) ? raw : [raw];
  const uses: ParsedToolUse[] = [];

  for (const tu of list) {
    if (tu?.tool_name) {
      uses.push({
        toolName: tu.tool_name,
        parameters: tu.parameters ? JSON.stringify(tu.parameters) : "{}",
        hasResult: tu.tool_result !== undefined,
        result: tu.tool_result != null ? JSON.stringify(tu.tool_result) : "",
      });
    }
  }

  return uses;
}

// ─── Regex-based flat parsing (streaming fallback) ───────────────
// While the JSON is still arriving in chunks, we extract fields by
// regex and pair them positionally. Not perfect (tool_result content
// can leak through as false titles) but the tree parser corrects
// everything once the full JSON arrives.

function extractStepsFlat(
  content: string,
  allToolUses: ParsedToolUse[],
): ReasoningStep[] {
  const titles = extractAllComplete(content, "title");
  const thoughts = extractAllComplete(content, "thought");
  const conclusions = extractAllComplete(content, "conclusion");
  const partialThought = extractPartialField(content, "thought");

  const stepCount = Math.max(titles.length, thoughts.length);
  if (stepCount === 0 && !partialThought) return [];

  const totalSteps = partialThought ? Math.max(stepCount, 1) : stepCount;

  const titlePositions = findAllPositions(content, /"title"\s*:\s*"/g);
  const toolPositions = findAllPositions(content, /"tool_name"\s*:\s*"/g);

  const steps: ReasoningStep[] = [];

  for (let i = 0; i < totalSteps; i++) {
    const hasFullThought = i < thoughts.length;
    const hasConclusion = i < conclusions.length;

    const thought = hasFullThought
      ? thoughts[i]
      : i === totalSteps - 1 && partialThought
        ? partialThought
        : "";

    const stepTools = associateToolsWithStep(
      i, titlePositions, toolPositions, allToolUses,
    );

    let status: ReasoningStep["status"] = "thinking";
    if (hasConclusion) status = "complete";
    else if (stepTools.some((t) => !t.hasResult)) status = "tool-use";

    steps.push({
      title: titles[i] ?? `Step ${i + 1}`,
      thought,
      conclusion: conclusions[i] ?? "",
      toolUses: stepTools,
      status,
      depth: 0,
    });
  }

  return steps;
}

function associateToolsWithStep(
  stepIdx: number,
  titlePositions: number[],
  toolPositions: number[],
  allToolUses: ParsedToolUse[],
): ParsedToolUse[] {
  if (allToolUses.length === 0) return [];
  if (titlePositions.length === 0) return allToolUses;

  const start = titlePositions[stepIdx] ?? 0;
  const end = titlePositions[stepIdx + 1] ?? Infinity;

  return toolPositions.reduce<ParsedToolUse[]>((acc, pos, i) => {
    if (pos >= start && pos < end && i < allToolUses.length) {
      acc.push(allToolUses[i]);
    }
    return acc;
  }, []);
}

function findAllPositions(content: string, re: RegExp): number[] {
  const positions: number[] = [];
  let m;
  while ((m = re.exec(content)) !== null) positions.push(m.index);
  return positions;
}

// ─── JSON string field extraction ────────────────────────────────

function readJsonStringValue(raw: string): { value: string; closed: boolean } {
  let result = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length) {
      const c = raw[++i];
      const escapes: Record<string, string> = {
        n: "\n", t: "\t", '"': '"', "\\": "\\", "/": "/",
      };
      result += escapes[c] ?? c;
    } else if (raw[i] === '"') {
      return { value: result, closed: true };
    } else {
      result += raw[i];
    }
  }
  return { value: result, closed: false };
}

function extractJsonStringField(content: string, field: string): string | null {
  const marker = `"${field}"`;
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return null;

  const afterMarker = content.slice(idx + marker.length);
  const colon = afterMarker.indexOf(":");
  if (colon === -1) return null;

  const afterColon = afterMarker.slice(colon + 1).trimStart();
  if (!afterColon.startsWith('"')) return null;

  return readJsonStringValue(afterColon.slice(1)).value;
}

function extractAllComplete(content: string, field: string): string[] {
  const values: string[] = [];
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
  let match;
  while ((match = re.exec(content)) !== null) {
    const v = unesc(match[1]);
    if (v.trim()) values.push(v);
  }
  return values;
}

function extractPartialField(content: string, field: string): string | null {
  const marker = `"${field}"`;
  const idx = content.lastIndexOf(marker);
  if (idx === -1) return null;

  const afterMarker = content.slice(idx + marker.length);
  const colon = afterMarker.indexOf(":");
  if (colon === -1) return null;

  const afterColon = afterMarker.slice(colon + 1).trimStart();
  if (!afterColon.startsWith('"')) return null;

  const { value, closed } = readJsonStringValue(afterColon.slice(1));
  return closed ? null : value;
}

// ─── Tool use extraction ─────────────────────────────────────────

function extractToolUses(content: string): ParsedToolUse[] {
  const tools: ParsedToolUse[] = [];
  const re = /"tool_name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = re.exec(content)) !== null) {
    const afterMatch = content.slice(match.index);
    const nextToolIdx = afterMatch.indexOf('"tool_name"', 10);
    const scope = nextToolIdx > 0 ? afterMatch.slice(0, nextToolIdx) : afterMatch;

    const resultMatch = scope.match(/"tool_result"\s*:\s*(\{[^}]*\})/);
    tools.push({
      toolName: unesc(match[1]),
      parameters: scope.match(/"parameters"\s*:\s*(\{[^}]*\})/)?.[1] ?? "{}",
      hasResult: /"tool_result"\s*:/.test(scope),
      result: resultMatch?.[1] ?? "",
    });
  }

  return tools;
}

function unesc(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\\//g, "/");
}
