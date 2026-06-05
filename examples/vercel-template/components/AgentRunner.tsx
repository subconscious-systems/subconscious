/**
 * Orchestrates Subconscious agent runs.
 *
 * When a user submits a task, this component:
 *   1. POSTs to /api/agent/stream
 *   2. Reads SSE events as they arrive:
 *      - tool_call / tool_result  → live tool activity feed
 *      - delta                    → streaming answer text
 *      - done                     → run complete
 *      - error                    → run failed
 *   3. Updates the UI in real time
 */

"use client";

import { useRef, useState } from "react";
import { RunResult } from "./RunResult";
import { StreamingText } from "./StreamingText";
import type { ParsedToolUse } from "@/lib/stream-parser";

export interface AgentRun {
  id: number;
  task: string;
  status: "running" | "complete" | "error";
  answer: string;
  toolInvocations: ParsedToolUse[];
  durationMs?: number;
}

interface AgentRunnerProps {
  onToolActivity?: (invocations: ParsedToolUse[]) => void;
}

let runCounter = 0;

export function AgentRunner({ onToolActivity }: AgentRunnerProps) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom(): void {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  function updateRun(id: number, patch: Partial<AgentRun>): void {
    setRuns((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  async function handleRun(): Promise<void> {
    const task = input.trim();
    if (!task || loading) return;

    const runId = ++runCounter;
    const startTime = Date.now();

    setRuns((prev) => [
      ...prev,
      {
        id: runId,
        task,
        status: "running",
        answer: "",
        toolInvocations: [],
      },
    ]);
    setInput("");
    setLoading(true);
    onToolActivity?.([]);
    scrollToBottom();

    try {
      await consumeStream(task, (patch) => {
        updateRun(runId, patch);
        if (patch.toolInvocations) onToolActivity?.(patch.toolInvocations);
        scrollToBottom();
      });

      updateRun(runId, {
        status: "complete",
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      updateRun(runId, {
        status: "error",
        answer: msg,
        durationMs: Date.now() - startTime,
      });
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  const activeRun = runs.find((r) => r.status === "running");
  const completedRuns = runs.filter((r) => r.status !== "running");

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-(--border) p-5">
        <label
          htmlFor="task-input"
          className={[
            "block text-[11px] font-semibold",
            "text-(--cream)/50 uppercase tracking-wider mb-2",
          ].join(" ")}
        >
          Task
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleRun();
          }}
          className="flex gap-3"
        >
          <textarea
            id="task-input"
            className={[
              "flex-1 bg-black/30 text-(--cream) text-sm",
              "rounded-xl px-4 py-3 outline-none resize-none",
              "border border-(--border)",
              "placeholder:text-(--cream)/25",
              "focus:border-(--accent)/50",
              "focus:ring-1 focus:ring-(--accent)/20",
              "transition-all min-h-[44px] max-h-32",
            ].join(" ")}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleRun();
              }
            }}
            placeholder="Describe a task for the agent..."
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className={[
              "px-5 py-3 text-sm font-semibold rounded-xl",
              "transition-all self-end",
              "disabled:opacity-30 disabled:cursor-not-allowed",
              loading
                ? "bg-(--accent)/15 text-(--accent) border border-(--accent)/25"
                : "bg-(--accent) text-(--color-primary-black) hover:brightness-110 active:scale-[0.98]",
            ].join(" ")}
          >
            {loading ? "Running..." : "Run Agent"}
          </button>
        </form>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {runs.length === 0 && <EmptyState />}

        {completedRuns.map((run) => (
          <RunResult key={run.id} run={run} />
        ))}

        {activeRun && (
          <div className="border-b border-(--border) p-5 animate-fade-in">
            <RunHeader run={activeRun} />

            {activeRun.toolInvocations.length > 0 && (
              <div className="mt-4 space-y-1">
                {activeRun.toolInvocations.map((inv, i) => (
                  <div
                    key={`${inv.toolName}-${i}`}
                    className="flex items-center gap-2 text-xs text-(--cream)/50"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        inv.hasResult
                          ? "bg-(--green)"
                          : "bg-(--accent) animate-pulse"
                      }`}
                    />
                    <span className="font-mono text-(--teal)">{inv.toolName}</span>
                    <span className="text-(--cream)/30">
                      {inv.hasResult ? "done" : "running..."}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activeRun.answer ? (
              <div className="mt-4 rounded-xl bg-black/20 border border-(--border) p-4">
                <StreamingText text={activeRun.answer} />
              </div>
            ) : (
              <div className="mt-4">
                <StreamingText />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RunHeader({ run }: { run: AgentRun }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-(--cream) font-medium leading-snug">
          {run.task}
        </p>
      </div>
      <StatusBadge status={run.status} durationMs={run.durationMs} />
    </div>
  );
}

export function StatusBadge({
  status,
  durationMs,
}: {
  status: AgentRun["status"];
  durationMs?: number;
}) {
  const config = {
    running: {
      dot: "bg-(--accent) animate-pulse",
      text: "text-(--accent)",
      bg: "bg-(--accent)/10 border-(--accent)/20",
      label: "Running",
    },
    complete: {
      dot: "bg-(--green)",
      text: "text-(--green)",
      bg: "bg-(--green)/10 border-(--green)/20",
      label: "Complete",
    },
    error: {
      dot: "bg-red-400",
      text: "text-red-400",
      bg: "bg-red-950/40 border-red-800/30",
      label: "Error",
    },
  }[status];

  const duration =
    durationMs !== undefined
      ? durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(1)}s`
      : null;

  return (
    <div
      className={[
        "shrink-0 flex items-center gap-1.5",
        "text-[11px] font-medium px-2.5 py-1",
        "rounded-full border",
        config.bg,
      ].join(" ")}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      <span className={config.text}>{config.label}</span>
      {duration && (
        <span className="text-(--cream)/30 ml-0.5">{duration}</span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-sm">
        <div
          className={[
            "mx-auto w-12 h-12 rounded-xl",
            "bg-(--accent)/10 border border-(--accent)/15",
            "flex items-center justify-center mb-4",
          ].join(" ")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-(--accent)"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-(--cream)/80 mb-1">
          Ready to run
        </p>
        <p className="text-xs text-(--cream)/35 leading-relaxed">
          Describe a task above and the agent will reason through it,
          using tools as needed.
        </p>
      </div>
    </div>
  );
}

// ─── SSE event types ─────────────────────────────────────────────

interface SSEToolCallEvent {
  type: "tool_call";
  tool: string;
  args: Record<string, unknown>;
}

interface SSEToolResultEvent {
  type: "tool_result";
  tool: string;
  result: unknown;
}

interface SSEDeltaEvent {
  type: "delta";
  content: string;
}

interface SSEDoneEvent {
  type: "done";
}

interface SSEErrorEvent {
  type: "error";
  message: string;
}

type SSEEvent =
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSEDeltaEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ─── Stream consumer ─────────────────────────────────────────────

async function consumeStream(
  task: string,
  onUpdate: (patch: Partial<AgentRun>) => void,
): Promise<void> {
  const res = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: task }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) detail = err.error;
    } catch {
      /* response wasn't JSON, use status code */
    }
    throw new Error(detail);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let answerSoFar = "";
  let toolInvocations: ParsedToolUse[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSSELine(line);
      if (!event) continue;

      if (event.type === "tool_call") {
        // Add a pending tool invocation
        toolInvocations = [
          ...toolInvocations,
          {
            toolName: event.tool,
            parameters: JSON.stringify(event.args),
            hasResult: false,
            result: "",
          },
        ];
        onUpdate({ toolInvocations });
      } else if (event.type === "tool_result") {
        // Mark the matching invocation as done
        toolInvocations = toolInvocations.map((inv) =>
          inv.toolName === event.tool && !inv.hasResult
            ? {
                ...inv,
                hasResult: true,
                result: JSON.stringify(event.result),
              }
            : inv,
        );
        onUpdate({ toolInvocations });
      } else if (event.type === "delta") {
        answerSoFar += event.content;
        onUpdate({ answer: answerSoFar });
      } else if (event.type === "done") {
        onUpdate({ answer: answerSoFar, toolInvocations });
        return;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
}

function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const raw = trimmed.slice(5).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SSEEvent;
  } catch {
    return null;
  }
}
