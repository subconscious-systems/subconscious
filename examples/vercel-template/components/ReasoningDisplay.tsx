/**
 * Renders the Subconscious agent's reasoning tree as a timeline.
 *
 * Each reasoning step can contain:
 *   - thought:    the agent's internal reasoning
 *   - toolUses:   tools the agent invoked (and their results)
 *   - conclusion: the step's outcome
 *
 * Nested subtasks are indented to show how the agent decomposes
 * complex problems into sub-problems.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReasoningStep, ParsedToolUse } from "@/lib/stream-parser";
import { formatToolParams } from "@/lib/stream-parser";

interface ReasoningDisplayProps {
  steps: ReasoningStep[];
  isStreaming: boolean;
}

export function ReasoningDisplay({
  steps,
  isStreaming,
}: ReasoningDisplayProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const topLevelCount = useMemo(
    () => steps.filter((s) => s.depth === 0).length,
    [steps],
  );
  const completedCount = useMemo(
    () => steps.filter((s) => s.status === "complete").length,
    [steps],
  );

  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps, collapsed]);

  if (steps.length === 0) return null;

  let topIdx = 0;

  return (
    <div className="animate-fade-in">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className={[
          "flex items-center gap-2 w-full text-left",
          "text-[12px] font-semibold",
          "text-(--cream)/50 hover:text-(--cream)/70",
          "transition-colors mb-3 group",
        ].join(" ")}
      >
        <span className="text-[10px] text-(--cream)/30 group-hover:text-(--cream)/50 transition-colors">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
        {isStreaming && (
          <span className="h-2 w-2 rounded-full bg-(--accent) animate-pulse" />
        )}
        <span>
          {isStreaming
            ? `Reasoning \u2014 ${completedCount}/${steps.length} steps`
            : `Reasoning \u2014 ${topLevelCount} step${topLevelCount > 1 ? "s" : ""}`}
        </span>
      </button>

      {!collapsed && (
        <div className="relative">
          <div
            ref={scrollRef}
            className="space-y-1 max-h-[400px] overflow-y-auto pr-1 pb-10"
          >
            {steps.map((step, i) => {
              const num = step.depth === 0 ? ++topIdx : 0;
              return (
                <StepCard
                  key={i}
                  step={step}
                  stepNumber={num}
                  isActive={
                    i === steps.length - 1 &&
                    isStreaming &&
                    step.status !== "complete"
                  }
                />
              );
            })}
          </div>
          <div
            className={[
              "pointer-events-none absolute bottom-0 left-0 right-0 h-8",
              "bg-gradient-to-t from-(--color-primary-black) via-(--color-primary-black)/60 to-transparent",
            ].join(" ")}
            style={{
              maskImage: "linear-gradient(to top, black, transparent)",
              WebkitMaskImage: "linear-gradient(to top, black, transparent)",
              boxShadow: "0 -8px 20px 4px rgba(255, 92, 40, 0.08)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Step card ───────────────────────────────────────────────────

function StepCard({
  step,
  stepNumber,
  isActive,
}: {
  step: ReasoningStep;
  stepNumber: number;
  isActive: boolean;
}) {
  const borderColor = isActive
    ? "border-l-(--accent)/40"
    : step.status === "complete"
      ? "border-l-(--green)/30"
      : "border-l-(--border)";

  return (
    <div
      style={step.depth > 0 ? { marginLeft: `${step.depth * 20}px` } : undefined}
      className={[
        "animate-fade-in rounded-lg",
        "bg-(--accent)/3 border border-(--border)",
        "overflow-hidden",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center gap-2.5 px-4 py-2.5",
          "border-l-2",
          borderColor,
        ].join(" ")}
      >
        <StepIndicator
          n={stepNumber}
          status={step.status}
          active={isActive}
          isSubtask={step.depth > 0}
        />
        <span
          className={[
            "font-semibold flex-1",
            step.depth > 0
              ? "text-[11px] text-(--cream)/55"
              : "text-[12px] text-(--cream)/70",
          ].join(" ")}
        >
          {step.title}
        </span>
        <StepStatusLabel status={step.status} active={isActive} />
      </div>

      <div
        className={[
          "px-4 pb-3 space-y-2.5",
          "border-l-2 ml-0",
          borderColor,
        ].join(" ")}
      >
        {step.thought && (
          <ThoughtBlock
            text={step.thought}
            isStreaming={isActive && step.status === "thinking"}
          />
        )}

        {step.toolUses.length > 0 && (
          <div className="space-y-2">
            {step.toolUses.map((tu, j) => (
              <ToolCallCard key={j} tool={tu} />
            ))}
          </div>
        )}

        {step.conclusion && <ConclusionBlock text={step.conclusion} />}
      </div>
    </div>
  );
}

// ─── Step indicators ─────────────────────────────────────────────

function StepIndicator({
  n,
  status,
  active,
  isSubtask,
}: {
  n: number;
  status: ReasoningStep["status"];
  active: boolean;
  isSubtask: boolean;
}) {
  if (status === "complete") {
    const size = isSubtask ? "h-4 w-4" : "h-5 w-5";
    const iconSize = isSubtask ? "8" : "10";
    return (
      <span
        className={`flex items-center justify-center shrink-0 ${size} rounded-full bg-(--green)/15`}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-(--green)"
        >
          <path d="M3 8.5l3.5 3.5 6.5-8" />
        </svg>
      </span>
    );
  }

  if (isSubtask) {
    return (
      <span className="flex items-center justify-center h-4 w-4 shrink-0">
        <span
          className={[
            "h-1.5 w-1.5 rounded-full",
            active ? "bg-(--accent) animate-pulse" : "bg-(--cream)/20",
          ].join(" ")}
        />
      </span>
    );
  }

  return (
    <span
      className={[
        "flex items-center justify-center shrink-0",
        "h-5 w-5 rounded-full text-[10px] font-bold",
        active
          ? "bg-(--accent)/20 text-(--accent)"
          : "bg-(--cream)/8 text-(--cream)/40",
      ].join(" ")}
    >
      {n}
    </span>
  );
}

function StepStatusLabel({
  status,
  active,
}: {
  status: ReasoningStep["status"];
  active: boolean;
}) {
  if (status === "complete") {
    return (
      <span className="text-[10px] font-medium text-(--green)/70">
        done
      </span>
    );
  }
  if (active && status === "thinking") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-(--accent)/70">
        <span className="h-1 w-1 rounded-full bg-(--accent) animate-pulse" />
        thinking
      </span>
    );
  }
  if (active && status === "tool-use") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-(--teal)/70">
        <span className="h-1 w-1 rounded-full bg-(--teal) animate-pulse" />
        using tool
      </span>
    );
  }
  return null;
}

// ─── Content blocks ──────────────────────────────────────────────

function ThoughtBlock({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  return (
    <div
      className={[
        "rounded-md px-3 py-2",
        "bg-(--accent)/4",
        "border-l-2 border-(--accent)/10",
      ].join(" ")}
    >
      <p
        className={[
          "text-xs leading-relaxed text-(--cream)/45",
          isStreaming ? "streaming-cursor" : "",
        ].join(" ")}
      >
        {text}
      </p>
    </div>
  );
}

function ToolCallCard({ tool }: { tool: ParsedToolUse }) {
  const isDone = tool.hasResult;
  const params = tool.parameters !== "{}" ? tool.parameters : null;

  return (
    <div
      className={[
        "rounded-md border overflow-hidden",
        isDone
          ? "border-(--green)/15 bg-(--green)/3"
          : "border-(--teal)/15 bg-(--teal)/3",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <ToolIcon done={isDone} />
        <span className="text-[11px] font-semibold font-mono text-(--teal)">
          {tool.toolName}
        </span>
        <span className="ml-auto">
          {isDone ? (
            <span className="flex items-center gap-1 text-[10px] text-(--green)/70 font-medium">
              <CheckIcon />
              returned
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-(--accent)/60 font-medium">
              <span className="h-1 w-1 rounded-full bg-(--accent) animate-pulse" />
              calling...
            </span>
          )}
        </span>
      </div>

      {params && (
        <div className="border-t border-(--border) px-3 py-1.5">
          <pre className="text-[11px] text-(--cream)/40 font-mono leading-relaxed">
            {formatToolParams(params)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ConclusionBlock({ text }: { text: string }) {
  return (
    <p className="text-xs leading-relaxed text-(--green)/50 pl-3 border-l border-(--green)/20">
      {text}
    </p>
  );
}

// ─── Icons ───────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-(--green)"
    >
      <path d="M3 8.5l3.5 3.5 6.5-8" />
    </svg>
  );
}

function ToolIcon({ done }: { done: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={done ? "text-(--green)/60" : "text-(--teal)/60"}
    >
      <path d="M10 2l4 4-1.5 1.5-4-4L10 2z" />
      <path d="M8.5 3.5L2 10v4h4l6.5-6.5" />
    </svg>
  );
}
