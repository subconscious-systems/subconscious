"use client";

import { useState } from "react";
import { ReasoningDisplay } from "./ReasoningDisplay";
import { StatusBadge, type AgentRun } from "./AgentRunner";

interface RunResultProps {
  run: AgentRun;
}

function getErrorInfo(message: string): {
  title: string;
  body: string;
  hint?: string;
} {
  if (/SUBCONSCIOUS_API_KEY.*not set/i.test(message)) {
    return {
      title: "API key not configured",
      body: "SUBCONSCIOUS_API_KEY is missing from your environment.",
      hint: "Add it to .env.local and restart the dev server. Get your key at subconscious.dev/platform",
    };
  }
  if (/authentication|unauthorized|invalid.*key|401/i.test(message)) {
    return {
      title: "Invalid API key",
      body: "The API key was rejected by Subconscious.",
      hint: "Check that SUBCONSCIOUS_API_KEY in .env.local is correct. Get a new key at subconscious.dev/platform",
    };
  }
  if (/rate.?limit|429/i.test(message)) {
    return {
      title: "Rate limited",
      body: "Too many requests to the Subconscious API.",
      hint: "Wait a moment and try again.",
    };
  }
  if (/timeout|timed.?out/i.test(message)) {
    return {
      title: "Request timed out",
      body: "The agent took too long to respond.",
      hint: "Try a simpler task or check your network connection.",
    };
  }
  return {
    title: "Something went wrong",
    body: message || "An unknown error occurred.",
  };
}

export function RunResult({ run }: RunResultProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = run.status === "error";
  const errorInfo = isError ? getErrorInfo(run.answer) : null;

  return (
    <div className="border-b border-(--border) animate-fade-in">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={[
          "w-full text-left p-5",
          "hover:bg-(--surface-light)/20",
          "transition-colors group",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={[
                "text-sm text-(--cream) font-medium leading-snug",
                "group-hover:text-(--accent)",
                "transition-colors",
              ].join(" ")}
            >
              {run.task}
            </p>
            {!expanded && !isError && run.answer && (
              <p className="text-xs text-(--cream)/40 mt-1.5 line-clamp-2 leading-relaxed">
                {run.answer}
              </p>
            )}
            {!expanded && isError && errorInfo && (
              <p className="text-xs text-red-400 mt-1.5 font-medium">
                {errorInfo.title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge
              status={run.status}
              durationMs={run.durationMs}
            />
            <span className="text-[10px] text-(--cream)/30 group-hover:text-(--cream)/50 transition-colors">
              {expanded ? "\u25BE" : "\u25B8"}
            </span>
          </div>
        </div>
      </button>

      {isError && errorInfo && (
        <div className="px-5 pb-5 animate-fade-in">
          <div className="rounded-xl bg-red-950/40 border border-red-800/40 p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-red-400"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3M8 10.5v.5" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-300">
                  {errorInfo.title}
                </p>
                <p className="text-sm text-red-300/70 mt-1 leading-relaxed">
                  {errorInfo.body}
                </p>
                {errorInfo.hint && (
                  <p className="text-xs text-red-300/50 mt-2 leading-relaxed">
                    {errorInfo.hint}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {expanded && !isError && (
        <div className="px-5 pb-5 animate-fade-in">
          {run.steps.length > 0 && (
            <div className="mb-4">
              <ReasoningDisplay steps={run.steps} isStreaming={false} />
            </div>
          )}

          {run.answer && (
            <div>
              <div className="text-[11px] font-semibold text-(--cream)/40 uppercase tracking-wider mb-2">
                Result
              </div>
              <div className="rounded-xl bg-black/20 border border-(--border) p-4">
                <p className="text-sm text-(--cream)/80 leading-relaxed whitespace-pre-wrap">
                  {run.answer}
                </p>
              </div>
            </div>
          )}

          {run.toolInvocations.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold text-(--cream)/40 uppercase tracking-wider mb-2">
                Tools Used
              </div>
              <div className="flex flex-wrap gap-1.5">
                {run.toolInvocations.map((inv, i) => (
                  <span
                    key={i}
                    className={[
                      "text-[11px] font-mono",
                      "text-(--teal)",
                      "bg-(--teal)/10",
                      "border border-(--teal)/20",
                      "px-2 py-0.5 rounded",
                    ].join(" ")}
                  >
                    {inv.toolName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
