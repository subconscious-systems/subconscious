"use client";

import { useState } from "react";
import { ReasoningDisplay } from "./ReasoningDisplay";
import { StatusBadge, type AgentRun } from "./AgentRunner";

interface RunResultProps {
  run: AgentRun;
}

export function RunResult({ run }: RunResultProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = run.status === "error";

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
            {!expanded && isError && (
              <p className="text-xs text-red-400/80 mt-1.5">
                {run.answer}
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

      {expanded && (
        <div className="px-5 pb-5 animate-fade-in">
          {run.steps.length > 0 && (
            <div className="mb-4">
              <ReasoningDisplay steps={run.steps} isStreaming={false} />
            </div>
          )}

          {isError ? (
            <div className="rounded-xl bg-red-950/20 border border-red-900/30 p-4">
              <p className="text-sm text-red-300 leading-relaxed">
                {run.answer}
              </p>
            </div>
          ) : (
            run.answer && (
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
            )
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
