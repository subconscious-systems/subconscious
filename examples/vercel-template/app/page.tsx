"use client";

import { useState } from "react";
import { AgentRunner } from "@/components/AgentRunner";
import { ToolPanel } from "@/components/ToolPanel";
import type { ParsedToolUse } from "@/lib/stream-parser";
import Image from "next/image";

export default function Home() {
  const [toolInvocations, setToolInvocations] = useState<
    ParsedToolUse[]
  >([]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />

      <main className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          <AgentRunner onToolActivity={setToolInvocations} />
        </div>

        <aside className="hidden lg:flex w-80 xl:w-88 border-l border-(--border) flex-col">
          <ToolPanel invocations={toolInvocations} />
        </aside>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header
      className={[
        "flex items-center justify-between",
        "px-5 py-3 border-b border-(--border)",
        "shrink-0 bg-(--surface)/80 backdrop-blur-sm",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Subconscious"
          width={28}
          height={28}
          className="rounded-md"
        />
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-(--cream) tracking-tight">
            Subconscious
          </span>
          <span
            className={[
              "text-[10px] text-(--accent) font-semibold",
              "bg-(--accent)/10 border border-(--accent)/20",
              "px-2 py-0.5 rounded-full",
            ].join(" ")}
          >
            Agent Runner
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <a
          href="https://docs.subconscious.dev"
          target="_blank"
          rel="noopener noreferrer"
          className={[
            "text-[11px] text-(--cream)/60",
            "hover:text-(--accent) transition-colors",
          ].join(" ")}
        >
          Docs
        </a>
        <a
          href="https://subconscious.dev/platform"
          target="_blank"
          rel="noopener noreferrer"
          className={[
            "text-[11px] text-(--cream)/60",
            "hover:text-(--accent) transition-colors",
          ].join(" ")}
        >
          Platform
        </a>
      </div>
    </header>
  );
}
