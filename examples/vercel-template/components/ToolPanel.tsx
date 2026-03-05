/**
 * Sidebar showing available Subconscious tools and live invocations.
 *
 * "platform" tools are hosted by Subconscious (e.g. web_search).
 * "self-hosted" tools are your own API routes that Subconscious calls.
 */

"use client";

import { getToolRegistry } from "@/lib/tools";
import {
  formatToolParams,
  formatToolResult,
  type ParsedToolUse,
} from "@/lib/stream-parser";

interface ToolPanelProps {
  invocations: ParsedToolUse[];
}

export function ToolPanel({ invocations }: ToolPanelProps) {
  const activeNames = new Set(invocations.map((inv) => inv.toolName));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-(--border)">
        <h3 className="text-[11px] font-semibold text-(--cream)/40 uppercase tracking-wider mb-3">
          Agent Tools
        </h3>
        <div className="flex flex-col gap-1.5">
          {getToolRegistry().map((tool) => {
            const active = activeNames.has(tool.name);
            return (
              <div
                key={tool.name}
                className={[
                  "flex items-center gap-2.5 rounded-lg px-3 py-2",
                  "border transition-all",
                  active
                    ? "bg-(--accent)/5 border-(--accent)/20"
                    : "bg-black/20 border-(--border)",
                ].join(" ")}
              >
                <ToolTypeIcon type={tool.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-(--cream)/80 font-mono truncate">
                    {tool.name}
                  </div>
                  <div className="text-[11px] text-(--cream)/35 mt-0.5 truncate">
                    {tool.description}
                  </div>
                </div>
                <TypeBadge type={tool.type} />
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-(--cream)/10 px-3 py-2.5">
          <p className="text-[11px] text-(--cream)/30 leading-relaxed">
            Add your own tools in{" "}
            <code className="text-(--accent)/60 font-mono">lib/tools.ts</code>
            {" "}&mdash; name, description, parameters, handler. That&apos;s it.
          </p>
        </div>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-[11px] font-semibold text-(--cream)/40 uppercase tracking-wider mb-3">
          Tool Activity
        </h3>

        {invocations.length === 0 ? (
          <p className="text-xs text-(--cream)/25">
            Tool invocations appear here when the agent runs
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {invocations.map((inv, i) => (
              <div
                key={`${inv.toolName}-${i}`}
                className="rounded-lg border p-2.5 animate-fade-in bg-black/20 border-(--border)"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      inv.hasResult
                        ? "bg-(--green)"
                        : "bg-(--accent) animate-pulse"
                    }`}
                  />
                  <span className="font-mono text-xs text-(--teal)">
                    {inv.toolName}
                  </span>
                  <span className="text-[10px] text-(--cream)/30 ml-auto">
                    {inv.hasResult ? "done" : "running..."}
                  </span>
                </div>
                {inv.parameters !== "{}" && (
                  <pre className="mt-1.5 text-[11px] text-(--cream)/35 font-mono overflow-x-auto leading-relaxed">
                    {formatToolParams(inv.parameters)}
                  </pre>
                )}
                {inv.hasResult && inv.result && (
                  <div className="mt-2 pt-2 border-t border-(--border)">
                    <span className="text-[10px] font-semibold text-(--green)/60 uppercase tracking-wider">
                      Result
                    </span>
                    <pre className="mt-1 text-[11px] text-(--green)/80 font-mono overflow-x-auto leading-relaxed">
                      {formatToolResult(inv.result)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type ToolType = "platform" | "self-hosted" | "mcp";

function TypeBadge({ type }: { type: ToolType }) {
  const colors = {
    platform: "bg-(--teal)/10 text-(--teal) border-(--teal)/20",
    "self-hosted": "bg-(--accent)/10 text-(--accent) border-(--accent)/20",
    mcp: "bg-purple-500/10 text-purple-400 border-purple-400/20",
  };
  const labels = { platform: "platform", "self-hosted": "local", mcp: "mcp" };
  return (
    <span
      className={[
        "shrink-0 text-[10px] px-1.5 py-0.5",
        "rounded-full font-medium border",
        colors[type],
      ].join(" ")}
    >
      {labels[type]}
    </span>
  );
}

function ToolTypeIcon({ type }: { type: ToolType }) {
  if (type === "platform") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-(--teal) shrink-0"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2a10 10 0 0 1 3 6 10 10 0 0 1-3 6 10 10 0 0 1-3-6 10 10 0 0 1 3-6z" />
      </svg>
    );
  }
  if (type === "mcp") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-purple-400 shrink-0"
      >
        <circle cx="4" cy="8" r="2" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M6 8h4M10 4L6 8l4 4" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-(--accent) shrink-0"
    >
      <path d="M6 2L2 6l4 4M10 6l4 4-4 4" />
    </svg>
  );
}
