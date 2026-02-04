/**
 * Main app layout.
 * Renders the header, Chat panel, TodoList panel, and footer.
 */

import { Chat } from "./components/Chat";
import { TodoList } from "./components/TodoList";

export default function App() {
    return (
        <div className="min-h-screen bg-midnight">
            {/* Background pattern */}
            <div className="fixed inset-0 opacity-30">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 1px 1px, rgba(255,107,74,0.15) 1px, transparent 0)",
                        backgroundSize: "40px 40px",
                    }}
                />
            </div>

            <div className="relative z-10 p-6 md:p-10">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <header className="mb-10">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-2 h-2 rounded-full bg-ember animate-pulse" />
                            <span className="text-xs font-mono text-mist uppercase tracking-widest">
                                Subconscious + Convex
                            </span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3 tracking-tight">
                            AI Todo Assistant
                        </h1>
                        <p className="text-mist text-lg max-w-xl">
                            Chat with the agent to manage your todos.{" "}
                            <span className="text-coral">Watch them update in real-time.</span>
                        </p>
                    </header>

                    {/* Main grid */}
                    <div className="grid lg:grid-cols-2 gap-6">
                        <Chat />
                        <TodoList />
                    </div>

                    {/* Footer */}
                    <footer className="mt-10 text-center">
                        <p className="text-mist/50 text-sm font-mono">
                            Built with{" "}
                            <a
                                href="https://subconscious.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-coral hover:text-ember transition-colors"
                            >
                                Subconscious
                            </a>{" "}
                            +{" "}
                            <a
                                href="https://convex.dev"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sage hover:text-sage/80 transition-colors"
                            >
                                Convex
                            </a>
                        </p>
                    </footer>
                </div>
            </div>
        </div>
    );
}
