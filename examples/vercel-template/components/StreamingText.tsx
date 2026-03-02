"use client";

export function StreamingText({ text }: { text?: string }) {
  if (text) {
    return (
      <span className="text-(--cream)/80 text-sm whitespace-pre-wrap leading-relaxed">
        {text}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="h-1.5 w-1.5 rounded-full bg-(--accent) animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-(--accent) animate-bounce [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-(--accent) animate-bounce [animation-delay:300ms]" />
    </div>
  );
}
