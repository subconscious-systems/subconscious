/**
 * Retry Utility
 *
 * Provides exponential backoff retry logic for transient failures.
 * Used by sandbox initialization, tunnel setup, and API calls.
 */

import { verbose } from "../config";

/** Log only when verbose mode is enabled */
function log(message: string) {
  if (verbose) console.log(message);
}

/**
 * Configuration options for retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including the first try) */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps the exponential growth) */
  maxDelayMs: number;
  /** Optional list of error message patterns that are retryable */
  retryableErrors?: string[];
  /** Optional list of error message patterns that should NOT be retried */
  nonRetryableErrors?: string[];
}

/**
 * Default retry options for different operation types.
 */
export const DEFAULT_RETRY_OPTIONS = {
  sandbox: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "503", "timeout", "network"],
  },
  tunnel: {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    retryableErrors: ["ECONNRESET", "ETIMEDOUT", "connection", "tunnel"],
  },
  api: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    retryableErrors: ["ECONNRESET", "ETIMEDOUT", "503", "502", "504", "rate limit"],
  },
  execution: {
    maxAttempts: 2,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    retryableErrors: ["ECONNRESET", "sandbox", "connection"],
    nonRetryableErrors: ["SyntaxError", "TypeError", "ReferenceError", "NameError", "IndentationError"],
  },
} as const;

/**
 * Check if an error is retryable based on the options.
 */
function isRetryableError(error: Error, options: RetryOptions): boolean {
  const message = error.message?.toLowerCase() || "";
  const name = error.name?.toLowerCase() || "";
  const errorStr = `${name}: ${message}`;

  // Check non-retryable patterns first (these take precedence)
  if (options.nonRetryableErrors) {
    for (const pattern of options.nonRetryableErrors) {
      if (errorStr.toLowerCase().includes(pattern.toLowerCase())) {
        return false;
      }
    }
  }

  // If no retryable patterns specified, retry all errors
  if (!options.retryableErrors || options.retryableErrors.length === 0) {
    return true;
  }

  // Check if error matches any retryable pattern
  for (const pattern of options.retryableErrors) {
    if (errorStr.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @returns Delay in milliseconds with jitter applied
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry on failure.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @param onRetry - Optional callback called before each retry attempt
 * @returns The result of the function if successful
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(url),
 *   { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
 *   (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`)
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  let lastError: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isLastAttempt = attempt === options.maxAttempts - 1;
      const shouldRetry = !isLastAttempt && isRetryableError(lastError, options);

      if (!shouldRetry) {
        log(`[retry] Not retrying: ${isLastAttempt ? "max attempts reached" : "non-retryable error"}`);
        throw lastError;
      }

      const delayMs = calculateDelay(attempt, options.baseDelayMs, options.maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      } else {
        log(`[retry] Attempt ${attempt + 1}/${options.maxAttempts} failed: ${lastError.message}`);
        log(`[retry] Retrying in ${delayMs}ms...`);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options.
 *
 * @param defaultOptions - Default retry options for all calls
 * @returns A configured retry function
 *
 * @example
 * ```typescript
 * const retryWithSandboxConfig = createRetryWrapper(DEFAULT_RETRY_OPTIONS.sandbox);
 * const result = await retryWithSandboxConfig(() => sandbox.initialize());
 * ```
 */
export function createRetryWrapper(defaultOptions: RetryOptions) {
  return function <T>(
    fn: () => Promise<T>,
    overrideOptions?: Partial<RetryOptions>,
    onRetry?: (attempt: number, error: Error, delayMs: number) => void
  ): Promise<T> {
    const mergedOptions = { ...defaultOptions, ...overrideOptions };
    return withRetry(fn, mergedOptions, onRetry);
  };
}

/**
 * Retry result type for when you want to handle retries without throwing.
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

/**
 * Execute a function with retry, returning a result object instead of throwing.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @param onRetry - Optional callback called before each retry attempt
 * @returns RetryResult with success status, result or error, and attempt count
 */
export async function withRetrySafe<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<RetryResult<T>> {
  let attempts = 0;

  try {
    const result = await withRetry(
      async () => {
        attempts++;
        return await fn();
      },
      options,
      onRetry
    );
    return { success: true, result, attempts };
  } catch (error: any) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts,
    };
  }
}
