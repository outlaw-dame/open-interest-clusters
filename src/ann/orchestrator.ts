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
}

export interface AnnProviderSelection {
  activeProvider: string;
  attemptedProviders: string[];
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

  constructor(candidates: readonly AnnProviderCandidate[], options: AnnOrchestratorOptions = {}) {
    if (candidates.length === 0) {
      throw new Error("At least one ANN provider candidate is required");
    }

    this.candidates = sortedCandidates(candidates);
    this.failOpen = options.failOpen ?? true;
    this.healthCheckOnInit = options.healthCheckOnInit ?? true;
  }

  private async selectProvider(): Promise<AnnProviderCandidate> {
    if (this.active !== null) {
      return this.active;
    }

    const attempted: string[] = [];

    for (const candidate of this.candidates) {
      attempted.push(candidate.name);

      if (!this.healthCheckOnInit) {
        this.active = candidate;
        return candidate;
      }

      try {
        if (await isHealthy(candidate)) {
          this.active = candidate;
          return candidate;
        }
      } catch {
        continue;
      }
    }

    throw new Error(`No healthy ANN providers available: ${attempted.join(", ")}`);
  }

  private async withFallback<T>(operation: (provider: AnnProvider) => Promise<T>): Promise<T> {
    const primary = await this.selectProvider();

    try {
      return await operation(primary.provider);
    } catch (error) {
      if (!this.failOpen) {
        throw error;
      }

      for (const candidate of this.candidates) {
        if (candidate.name === primary.name) {
          continue;
        }

        try {
          if (!(await isHealthy(candidate))) {
            continue;
          }

          this.active = candidate;
          return await operation(candidate.provider);
        } catch {
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
