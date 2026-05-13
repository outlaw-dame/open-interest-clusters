import type {
  AnnIndexStats,
  AnnProvider,
  AnnSearchOptions,
  AnnSearchResult
} from "./types.js";
import type { EmbeddingVector } from "../embedding/types.js";

export type AnnOperation = "search" | "stats" | "upsert" | "delete";

export interface AnnProviderCandidate {
  name: string;
  provider: AnnProvider;
  priority?: number;
  healthCheck?: (provider: AnnProvider) => Promise<boolean>;
}

export interface AnnRetryPolicy {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryWrites?: boolean;
  isRetryable?: (error: unknown, operation: AnnOperation) => boolean;
}

export interface AnnProviderEvent {
  type: "provider_failure" | "provider_recovered" | "provider_selected" | "provider_retry";
  provider: string;
  operation?: AnnOperation;
  attempt?: number;
  delayMs?: number;
  error?: string;
}

export interface AnnOrchestratorOptions {
  failOpen?: boolean;
  healthCheckOnInit?: boolean;
  failureCooldownMs?: number;
  circuitBreakerThreshold?: number;
  retryPolicy?: AnnRetryPolicy;
  retrySleeper?: (delayMs: number) => Promise<void>;
  random?: () => number;
  onEvent?: (event: AnnProviderEvent) => void | Promise<void>;
}

export interface AnnProviderSelection {
  activeProvider: string;
  attemptedProviders: string[];
}

interface ProviderFailureState {
  failures: number;
  retryAfter: number;
}

const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

function sortedCandidates(candidates: readonly AnnProviderCandidate[]): AnnProviderCandidate[] {
  return [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

async function isHealthy(candidate: AnnProviderCandidate): Promise<boolean> {
  if (candidate.healthCheck !== undefined) {
    return candidate.healthCheck(candidate.provider);
  }

  await candidate.provider.stats();
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown ANN provider error";
}

function boundedPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

function defaultRetryable(error: unknown, operation: AnnOperation): boolean {
  if (operation === "upsert" || operation === "delete") {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && ["40001", "40P01", "53300", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes(code);
}

function retryDelay(baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const safeRandom = Math.max(0, Math.min(1, random()));
  const jitter = Math.floor(safeRandom * Math.max(1, Math.floor(baseDelayMs * 0.2)));
  return Math.min(maxDelayMs, baseDelayMs + jitter);
}

async function defaultSleeper(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export class AnnProviderOrchestrator implements AnnProvider {
  private active: AnnProviderCandidate | null = null;
  private readonly candidates: AnnProviderCandidate[];
  private readonly failOpen: boolean;
  private readonly healthCheckOnInit: boolean;
  private readonly failureCooldownMs: number;
  private readonly circuitBreakerThreshold: number;
  private readonly retryAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly retryWrites: boolean;
  private readonly isRetryable: (error: unknown, operation: AnnOperation) => boolean;
  private readonly retrySleeper: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private readonly onEvent: ((event: AnnProviderEvent) => void | Promise<void>) | undefined;
  private readonly failures = new Map<string, ProviderFailureState>();

  constructor(candidates: readonly AnnProviderCandidate[], options: AnnOrchestratorOptions = {}) {
    if (candidates.length === 0) {
      throw new Error("At least one ANN provider candidate is required");
    }

    this.candidates = sortedCandidates(candidates);
    this.failOpen = options.failOpen ?? true;
    this.healthCheckOnInit = options.healthCheckOnInit ?? true;
    this.failureCooldownMs = Math.max(0, options.failureCooldownMs ?? 5_000);
    this.circuitBreakerThreshold = Math.max(1, options.circuitBreakerThreshold ?? 3);
    this.retryAttempts = boundedPositiveInteger(options.retryPolicy?.attempts, DEFAULT_RETRY_ATTEMPTS, 1, 8);
    this.initialRetryDelayMs = boundedPositiveInteger(options.retryPolicy?.initialDelayMs, DEFAULT_INITIAL_RETRY_DELAY_MS, 1, 30_000);
    this.maxRetryDelayMs = boundedPositiveInteger(options.retryPolicy?.maxDelayMs, DEFAULT_MAX_RETRY_DELAY_MS, this.initialRetryDelayMs, 120_000);
    this.retryWrites = options.retryPolicy?.retryWrites ?? false;
    this.isRetryable = options.retryPolicy?.isRetryable ?? defaultRetryable;
    this.retrySleeper = options.retrySleeper ?? defaultSleeper;
    this.random = options.random ?? Math.random;
    this.onEvent = options.onEvent;
  }

  private now(): number {
    return Date.now();
  }

  private async emit(event: AnnProviderEvent): Promise<void> {
    await this.onEvent?.(event);
  }

  private isCircuitOpen(candidate: AnnProviderCandidate): boolean {
    const state = this.failures.get(candidate.name);
    if (state === undefined) {
      return false;
    }

    return state.retryAfter > this.now();
  }

  private async recordFailure(candidate: AnnProviderCandidate, operation: AnnOperation, error: unknown): Promise<void> {
    const existing = this.failures.get(candidate.name);
    const failures = (existing?.failures ?? 0) + 1;

    this.failures.set(candidate.name, {
      failures,
      retryAfter: failures >= this.circuitBreakerThreshold ? this.now() + this.failureCooldownMs : 0
    });

    if (this.active?.name === candidate.name) {
      this.active = null;
    }

    await this.emit({
      type: "provider_failure",
      provider: candidate.name,
      operation,
      error: errorMessage(error)
    });
  }

  private async clearFailure(candidate: AnnProviderCandidate): Promise<void> {
    if (this.failures.has(candidate.name)) {
      this.failures.delete(candidate.name);
      await this.emit({
        type: "provider_recovered",
        provider: candidate.name
      });
    }
  }

  private async selectProvider(): Promise<AnnProviderCandidate> {
    if (this.active !== null && !this.isCircuitOpen(this.active)) {
      return this.active;
    }

    const attempted: string[] = [];

    for (const candidate of this.candidates) {
      if (this.isCircuitOpen(candidate)) {
        continue;
      }

      attempted.push(candidate.name);

      if (!this.healthCheckOnInit) {
        this.active = candidate;
        await this.emit({ type: "provider_selected", provider: candidate.name });
        return candidate;
      }

      try {
        if (await isHealthy(candidate)) {
          await this.clearFailure(candidate);
          this.active = candidate;
          await this.emit({ type: "provider_selected", provider: candidate.name });
          return candidate;
        }
      } catch (error) {
        await this.recordFailure(candidate, "stats", error);
        continue;
      }
    }

    throw new Error(`No healthy ANN providers available: ${attempted.join(", ")}`);
  }

  private async runWithRetry<T>(
    candidate: AnnProviderCandidate,
    operationName: AnnOperation,
    operation: (provider: AnnProvider) => Promise<T>
  ): Promise<T> {
    const allowRetry = this.retryWrites || (operationName !== "upsert" && operationName !== "delete");
    let delayMs = this.initialRetryDelayMs;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await operation(candidate.provider);
      } catch (error) {
        lastError = error;

        if (!allowRetry || attempt >= this.retryAttempts || !this.isRetryable(error, operationName)) {
          throw error;
        }

        const nextDelayMs = retryDelay(delayMs, this.maxRetryDelayMs, this.random);
        await this.emit({
          type: "provider_retry",
          provider: candidate.name,
          operation: operationName,
          attempt,
          delayMs: nextDelayMs,
          error: errorMessage(error)
        });
        await this.retrySleeper(nextDelayMs);
        delayMs = Math.min(this.maxRetryDelayMs, delayMs * 2);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("ANN provider operation failed");
  }

  private async withFallback<T>(operationName: AnnOperation, operation: (provider: AnnProvider) => Promise<T>): Promise<T> {
    const primary = await this.selectProvider();

    try {
      const result = await this.runWithRetry(primary, operationName, operation);
      await this.clearFailure(primary);
      return result;
    } catch (error) {
      await this.recordFailure(primary, operationName, error);

      if (!this.failOpen) {
        throw error;
      }

      for (const candidate of this.candidates) {
        if (candidate.name === primary.name || this.isCircuitOpen(candidate)) {
          continue;
        }

        try {
          if (!(await isHealthy(candidate))) {
            continue;
          }

          await this.clearFailure(candidate);
          this.active = candidate;
          return await this.runWithRetry(candidate, operationName, operation);
        } catch (candidateError) {
          await this.recordFailure(candidate, operationName, candidateError);
          continue;
        }
      }

      throw error;
    }
  }

  async upsert(clusterId: string, vector: EmbeddingVector): Promise<void> {
    await this.withFallback("upsert", (provider) => provider.upsert(clusterId, vector));
  }

  async delete(clusterId: string): Promise<boolean> {
    return this.withFallback("delete", (provider) => provider.delete(clusterId));
  }

  async search(vector: EmbeddingVector, options?: AnnSearchOptions): Promise<AnnSearchResult[]> {
    return this.withFallback("search", (provider) => provider.search(vector, options));
  }

  async stats(): Promise<AnnIndexStats> {
    return this.withFallback("stats", (provider) => provider.stats());
  }

  async selection(): Promise<AnnProviderSelection> {
    const active = await this.selectProvider();

    return {
      activeProvider: active.name,
      attemptedProviders: this.candidates.map((candidate) => candidate.name)
    };
  }
}
