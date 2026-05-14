import {
  createCapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestratorOptions
} from "./capability-orchestrator.js";
import type { CapabilityAwareAnnExecutionResult } from "./capability-runner.js";
import type { CapableAnnProviderCandidate } from "./capabilities.js";
import type { AnnDeploymentRoutingOptions } from "./deployment-routing.js";
import type { EmbeddingVector } from "../embedding/types.js";
import type {
  AnnCircuitState,
  AnnIndexStats,
  AnnProviderEvent,
  AnnProviderHealthState,
  AnnProviderProbeResult,
  AnnRetryMetrics,
  AnnSearchOptions,
  AnnSearchResult
} from "./types.js";
import type { AnnProviderOrchestrator } from "./orchestrator.js";

export interface AdaptiveAnnReconfiguration {
  requirement?: CapabilityAwareAnnOrchestratorOptions["requirement"];
  deployment?: Omit<AnnDeploymentRoutingOptions, "requirement">;
}

export class AdaptiveCapabilityAnnOrchestrator {
  private readonly candidates: CapableAnnProviderCandidate[];
  private options: CapabilityAwareAnnOrchestratorOptions;
  private current: CapabilityAwareAnnOrchestrator;

  constructor(candidates: readonly CapableAnnProviderCandidate[], options: CapabilityAwareAnnOrchestratorOptions) {
    this.candidates = [...candidates];
    this.options = { ...options };
    this.current = createCapabilityAwareAnnOrchestrator(this.candidates, this.options);
  }

  reconfigure(reconfiguration: AdaptiveAnnReconfiguration): void {
    const nextOptions: CapabilityAwareAnnOrchestratorOptions = {
      ...this.options,
      ...reconfiguration,
      requirement: reconfiguration.requirement ?? this.options.requirement
    };

    const next = createCapabilityAwareAnnOrchestrator(this.candidates, nextOptions);
    this.options = nextOptions;
    this.current = next;
  }

  async upsert(clusterId: string, vector: EmbeddingVector): Promise<CapabilityAwareAnnExecutionResult<void>> {
    return this.current.upsert(clusterId, vector);
  }

  async delete(clusterId: string): Promise<CapabilityAwareAnnExecutionResult<boolean>> {
    return this.current.delete(clusterId);
  }

  async search(
    vector: EmbeddingVector,
    options?: AnnSearchOptions
  ): Promise<CapabilityAwareAnnExecutionResult<AnnSearchResult[]>> {
    return this.current.search(vector, options);
  }

  async stats(): Promise<CapabilityAwareAnnExecutionResult<AnnIndexStats>> {
    return this.current.stats();
  }

  getRetryMetrics(): AnnRetryMetrics {
    return this.current.getOrchestrator().getRetryMetrics();
  }

  getProviderHealth(): AnnProviderHealthState[] {
    return this.current.getOrchestrator().getProviderHealth();
  }

  getCircuitState(): AnnCircuitState {
    return this.current.getOrchestrator().getCircuitState();
  }

  getRecentEvents(): AnnProviderEvent[] {
    return this.current.getOrchestrator().getRecentEvents();
  }

  async probeProviders(): Promise<AnnProviderProbeResult[]> {
    return this.current.getOrchestrator().probeProviders();
  }

  getCurrent(): CapabilityAwareAnnOrchestrator {
    return this.current;
  }

  getOrchestrator(): AnnProviderOrchestrator {
    return this.current.getOrchestrator();
  }
}

export function createAdaptiveCapabilityAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): AdaptiveCapabilityAnnOrchestrator {
  return new AdaptiveCapabilityAnnOrchestrator(candidates, options);
}
