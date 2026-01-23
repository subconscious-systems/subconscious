/**
 * Structured Logger
 * 
 * Provides structured logging with levels for better debugging and monitoring.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
}

class Logger {
  private logs: LogEntry[] = [];
  private minLevel: LogLevel = "info";

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
    };

    this.logs.push(entry);

    // Format and output
    const prefix = `[${level.toUpperCase()}]`;
    const time = entry.timestamp.toISOString().split("T")[1].split(".")[0];
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";

    console.log(`${prefix} [${time}] ${message}${contextStr}`);
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.log("error", message, context);
  }

  /**
   * Get execution summary.
   */
  getSummary(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    errors: LogEntry[];
  } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };

    const errors: LogEntry[] = [];

    for (const entry of this.logs) {
      byLevel[entry.level]++;
      if (entry.level === "error") {
        errors.push(entry);
      }
    }

    return {
      total: this.logs.length,
      byLevel,
      errors,
    };
  }

  /**
   * Clear all logs.
   */
  clear(): void {
    this.logs = [];
  }
}

// Export singleton instance
export const logger = new Logger();
