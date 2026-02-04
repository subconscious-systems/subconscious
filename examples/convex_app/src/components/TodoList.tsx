/**
 * TodoList component.
 * Displays all todos and updates in real-time.
 *
 * useQuery(api.todos.list) creates a WebSocket subscription.
 * When the todos table changes from any source (including the AI
 * calling HTTP endpoints), this component re-renders automatically.
 */

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function TodoList() {
  const todos = useQuery(api.todos.list) ?? [];
  const clearCompleted = useMutation(api.todos.clearCompleted);
  const completedCount = todos.filter((t) => t.completed).length;
  const pendingCount = todos.length - completedCount;

  return (
    <div className="bg-dusk rounded-2xl border border-slate/50 h-[600px] flex flex-col card-glow overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sage to-emerald-400 flex items-center justify-center">
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Todos</h2>
            <p className="text-xs text-mist">
              {pendingCount} pending
              {completedCount > 0 && `, ${completedCount} done`}
            </p>
          </div>
        </div>

        {completedCount > 0 && (
          <button
            onClick={() => clearCompleted()}
            className="text-xs text-mist hover:text-white transition-colors font-mono"
          >
            Clear done
          </button>
        )}
      </div>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto p-5">
        {todos.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate/50 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-mist/30"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <p className="text-mist/50 text-sm">No todos yet</p>
            <p className="text-mist/30 text-xs mt-1">Ask the AI to add some</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo, index) => (
              <li
                key={todo._id}
                className={`group flex items-center gap-3 p-4 rounded-xl border transition-all duration-300 ${
                  todo.completed
                    ? "bg-slate/30 border-slate/30"
                    : "bg-slate/50 border-slate/50 hover:border-sage/30"
                }`}
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                <div
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    todo.completed
                      ? "bg-sage border-sage"
                      : "border-mist/30 group-hover:border-sage/50"
                  }`}
                >
                  {todo.completed && (
                    <svg
                      className="w-3 h-3 text-midnight"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>

                <span
                  className={`flex-1 text-sm transition-all ${
                    todo.completed
                      ? "text-mist/50 line-through"
                      : "text-white/90"
                  }`}
                >
                  {todo.text}
                </span>

                <span className="text-[10px] text-mist/30 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                  {todo._id.slice(-6)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Stats footer */}
      {todos.length > 0 && (
        <div className="px-5 py-3 border-t border-slate/50 flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-mist/50">
              Total: <span className="text-white">{todos.length}</span>
            </span>
            {completedCount > 0 && (
              <span className="text-mist/50">
                Done:{" "}
                <span className="text-sage">
                  {Math.round((completedCount / todos.length) * 100)}%
                </span>
              </span>
            )}
          </div>

          <div className="flex gap-1">
            {todos.slice(0, 5).map((todo) => (
              <div
                key={todo._id}
                className={`w-2 h-2 rounded-full ${
                  todo.completed ? "bg-sage" : "bg-ember"
                }`}
              />
            ))}
            {todos.length > 5 && (
              <span className="text-[10px] text-mist/30 ml-1">
                +{todos.length - 5}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
