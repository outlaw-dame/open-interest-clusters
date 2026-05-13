import type {
  AnnIndexStats,
  AnnProvider,
  AnnSearchOptions,
  AnnSearchResult
} from "./types.js";
import type { EmbeddingVector } from "../embedding/types.js";

export interface AnnProviderCandidate {
  name: string;
  provider: AnnProvider;
  priority?: number;
  healthCheck?: (provider: AnnProvider) => Promise<boolean>;
}

export interface AnnOrchestratorOptions {
  failOpen?: boolean;
  healthCheckOnInit?: boolean;
  failureCooldownMs?: number;
  circuitBreakerThreshold?: number;
}

export interface AnnProviderSelection {
  activeProvider: string;
  attemptedProviders: string[];
}

interface ProviderFailureState {
  failures: number;
  retryAfter: number;
}

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

export class AnnProviderOrchestrator implements AnnProvider {
  private active: AnnProviderCandidate | null = null;
  private readonly candidates: AnnProviderCandidate[];
  private readonly failOpen: boolean;
  private readonly healthCheckOnInit: boolean;
  private readonly failureCooldownMs: number;
  private readonly circuitBreakerThreshold: number;
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
  }

  private now(): number {
    return Date.now();
  }

  private isCircuitOpen(candidate: AnnProviderCandidate): boolean {
    const state = this.failures.get(candidate.name);
    if (state === undefined) {
      return false;
    }

    return state.retryAfter > this.now();
  }

  private recordFailure(candidate: AnnProviderCandidate): void {
    const existing = this.failures.get(candidate.name);
    const failures = (existing?.failures ?? 0) + 1;

    this.failures.set(candidate.name, {
      failures,
      retryAfter: failures >= this.circuitBreakerThreshold ? this.now() + this.failureCooldownMs : 0
    });

    if (this.active?.name === candidate.name) {
      this.active = null;
    }
  }

  private clearFailure(candidate: AnnProviderCandidate): void {
    this.failures.delete(candidate.name);
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
        return candidate;
      }

      try {
        if (await isHealthy(candidate)) {
          this.clearFailure(candidate);
          this.active = candidate;
          return candidate;
        }
      } catch {
        this.recordFailure(candidate);
        continue;
      }
    }

    throw new Error(`No healthy ANN providers available: ${attempted.join(", ")}`);
  }

  private async withFallback<T>(operation: (provider: AnnProvider) => Promise<T>): Promise<T> {
    const primary = await this.selectProvider();

    try {
      const result = await operation(primary.provider);
      this.clearFailure(primary);
      return result;
    } catch (error) {
      this.recordFailure(primary);

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

          this.clearFailure(candidate);
          this.active = candidate;
          return await operation(candidate.provider);
        } catch {
          this.recordFailure(candidate);
          continue;
        }
      }

      throw error;
    }
  }

  async upsert(clusterId: string, vector: EmbeddingVector): Promise<void> {
    await this.withFallback((provider) => provider.upsert(clusterId, vector));
  }

  async delete(clusterId: string): Promise<boolean> {
    return this.withFallback((provider) => provider.delete(clusterId));
  }

  async search(vector: EmbeddingVector, options?: AnnSearchOptions): Promise<AnnSearchResult[]> {
    return this.withFallback((provider) => provider.search(vector, options));
  }

  async stats(): Promise<AnnIndexStats> {
    return this.withFallback((provider) => provider.stats());
  }

  async selection(): Promise<AnnProviderSelection> {
    const active = await this.selectProvider();

    return {
      activeProvider: active.name,
      attemptedProviders: this.candidates.map((candidate) => candidate.name)
    };
  }
}
