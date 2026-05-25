import { setTimeout as sleep } from "node:timers/promises";

export interface RetryAttemptContext {
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
}

export interface RetryDecisionContext extends RetryAttemptContext {
  error: unknown;
}

export interface RetryScheduledEvent extends RetryDecisionContext {
  delayMs: number;
  nextAttempt: number;
}

export interface RetryPolicyOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
  jitterRatio?: number;
  signal?: AbortSignal;
  random?: () => number;
  shouldRetry?: (context: RetryDecisionContext) => boolean;
  onRetry?: (event: RetryScheduledEvent) => void | Promise<void>;
  retrySleeper?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 2_000;
const DEFAULT_JITTER_RATIO = 0.2;

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

function boundedRatio(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value ?? fallback));
}

function now(): number {
  return Date.now();
}

function createAbortError(): Error {
  const error = new Error("Operation aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw (signal.reason instanceof Error ? signal.reason : createAbortError());
  }
}

function retryDelay(baseDelayMs: number, maxDelayMs: number, random: () => number, jitterRatio: number): number {
  const safeRandom = Math.max(0, Math.min(1, random()));
  const jitterSpan = Math.floor(Math.max(1, baseDelayMs * jitterRatio));
  const jitter = Math.floor(safeRandom * jitterSpan);
  return Math.min(maxDelayMs, baseDelayMs + jitter);
}

async function defaultRetrySleeper(delayMs: number, signal?: AbortSignal): Promise<void> {
  await sleep(delayMs, undefined, signal === undefined ? undefined : { signal });
}

export async function executeWithRetry<T>(
  operation: (context: RetryAttemptContext) => Promise<T> | T,
  options: RetryPolicyOptions = {}
): Promise<T> {
  const attempts = boundedInteger(options.attempts, DEFAULT_ATTEMPTS, 1, 64);
  const initialDelayMs = boundedInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, 1, 60_000);
  const maxDelayMs = boundedInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, initialDelayMs, 300_000);
  const maxElapsedMs = options.maxElapsedMs === undefined
    ? undefined
    : boundedInteger(options.maxElapsedMs, 0, 1, 3_600_000);
  const jitterRatio = boundedRatio(options.jitterRatio, DEFAULT_JITTER_RATIO);
  const random = options.random ?? Math.random;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const retrySleeper = options.retrySleeper ?? defaultRetrySleeper;

  const startedAt = now();
  let nextBaseDelayMs = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const elapsedMs = now() - startedAt;
    throwIfAborted(options.signal);

    try {
      return await operation({ attempt, maxAttempts: attempts, elapsedMs });
    } catch (error) {
      lastError = error;
      const decisionContext: RetryDecisionContext = {
        attempt,
        maxAttempts: attempts,
        elapsedMs: now() - startedAt,
        error
      };

      if (attempt >= attempts || !shouldRetry(decisionContext)) {
        break;
      }

      if (maxElapsedMs !== undefined && decisionContext.elapsedMs >= maxElapsedMs) {
        break;
      }

      const delayMs = retryDelay(nextBaseDelayMs, maxDelayMs, random, jitterRatio);
      await options.onRetry?.({
        ...decisionContext,
        delayMs,
        nextAttempt: attempt + 1
      });

      await retrySleeper(delayMs, options.signal);
      nextBaseDelayMs = Math.min(maxDelayMs, nextBaseDelayMs * 2);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Retry policy exhausted without a captured error.");
}
