/**
 * Chat component.
 * Handles the chat interface where users talk to the AI.
 *
 * useQuery(api.messages.list) subscribes to messages.
 * When a new message is saved, this component re-renders automatically.
 *
 * We POST to our /chat endpoint which calls Subconscious.
 * While the AI is processing, it might call tools that update todos.
 * The TodoList updates before the AI even finishes responding.
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function Chat() {
  const messages = useQuery(api.messages.list) ?? [];
  const clearMessages = useMutation(api.messages.clear);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    try {
      const convexUrl = (
        import.meta.env.VITE_CONVEX_URL as string
      ).replace(".cloud", ".site");

      await fetch(`${convexUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-dusk rounded-2xl border border-slate/50 h-[600px] flex flex-col card-glow overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ember to-coral flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Chat</h2>
            <p className="text-xs text-mist">Talk to the assistant</p>
          </div>
        </div>
        <button
          onClick={() => clearMessages()}
          className="text-xs text-mist hover:text-white transition-colors font-mono"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="text-mist/50 text-sm">
              <p className="mb-2">Try saying:</p>
              <p className="font-mono text-coral/70">
                "Add buy groceries to my list"
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg._id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-ember to-coral text-white"
                  : "bg-slate text-white/90"
              }`}
            >
              <p className="text-sm leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 bg-ember rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-coral rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-sage rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
                <span className="text-sm text-mist">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate/50">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a todo, mark complete, or ask questions..."
            className="flex-1 px-4 py-3 bg-slate border border-slate/50 rounded-xl text-white placeholder:text-mist/50 focus:outline-none focus:border-ember/50 focus:ring-1 focus:ring-ember/25 transition-all text-sm"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-5 py-3 bg-gradient-to-r from-ember to-coral text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
