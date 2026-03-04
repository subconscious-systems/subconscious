/**
 * Orchestrates Subconscious agent runs.
 *
 * When a user submits a task, this component:
 *   1. POSTs to /api/agent/stream (which calls client.stream())
 *   2. Reads SSE delta events as they arrive
 *   3. Feeds accumulated content into parseStreamContent() to
 *      extract reasoning steps, tool calls, and the answer
 *   4. Updates the UI in real time
 *
 * See consumeStream() at the bottom for the streaming logic.
 */

"use client";

import { useRef, useState } from "react";
import { RunResult } from "./RunResult";
import { ReasoningDisplay } from "./ReasoningDisplay";
import { StreamingText } from "./StreamingText";
import {
  parseStreamContent,
  type ParsedToolUse,
  type ReasoningStep,
} from "@/lib/stream-parser";

export interface AgentRun {
  id: number;
  task: string;
  status: "running" | "complete" | "error";
  steps: ReasoningStep[];
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

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  function updateRun(id: number, patch: Partial<AgentRun>) {
    setRuns((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  async function handleRun() {
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
        steps: [],
        answer: "",
        toolInvocations: [],
      },
    ]);
    setInput("");
    setLoading(true);
    onToolActivity?.([]);
    scrollToBottom();

    try {
      const result = await consumeStream(task, (state) => {
        updateRun(runId, {
          steps: state.steps,
          answer: state.answer,
          toolInvocations: state.toolInvocations,
        });
        onToolActivity?.(state.toolInvocations);
        scrollToBottom();
      });

      const finishedTools = result.toolInvocations.map((t) => ({
        ...t,
        hasResult: true,
      }));

      updateRun(runId, {
        status: "complete",
        answer: result.answer,
        steps: result.steps.map((s) => ({
          ...s,
          status: "complete" as const,
        })),
        toolInvocations: finishedTools,
        durationMs: Date.now() - startTime,
      });
      onToolActivity?.(finishedTools);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong";
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
            handleRun();
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
                handleRun();
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

            {activeRun.steps.length > 0 ? (
              <div className="mt-4">
                <ReasoningDisplay
                  steps={activeRun.steps}
                  isStreaming
                />
              </div>
            ) : (
              <div className="mt-4">
                <StreamingText />
              </div>
            )}

            {activeRun.answer && (
              <div className="mt-4 rounded-xl bg-black/20 border border-(--border) p-4">
                <StreamingText text={activeRun.answer} />
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
          Describe a task above and the agent will reason through it
          step-by-step, using tools as needed.
        </p>
      </div>
    </div>
  );
}

// ─── Subconscious streaming integration ──────────────────────────
// Consumes the SSE stream from /api/agent/stream.
//
// Each "delta" event contains a content chunk. We concatenate all
// chunks and re-parse the accumulated string on every update using
// parseStreamContent() — this extracts reasoning steps, tool calls,
// and the answer from the partial (or complete) JSON.

async function consumeStream(
  task: string,
  onUpdate: (state: {
    steps: ReasoningStep[];
    answer: string;
    toolInvocations: ParsedToolUse[];
  }) => void,
) {
  const res = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: task }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
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
  let fullContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSSELine(line);
      if (!event) continue;

      if (event.type === "delta" && event.content) {
        fullContent += event.content;
        onUpdate(parseStreamContent(fullContent));
      } else if (event.type === "error") {
        throw new Error(event.message ?? "Stream error");
      }
    }
  }

  const finalState = parseStreamContent(fullContent);
  return {
    answer: finalState.answer || fullContent,
    steps: finalState.steps,
    toolInvocations: finalState.toolInvocations,
  };
}

function parseSSELine(
  line: string,
): { type: string; content?: string; message?: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const raw = trimmed.slice(5).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
