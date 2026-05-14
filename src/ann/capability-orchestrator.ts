import {
  AnnProviderOrchestrator,
  type AnnCircuitState,
  type AnnOrchestratorOptions,
  type AnnProviderEvent,
  type AnnProviderHealthState,
  type AnnProviderProbeResult,
  type AnnRetryMetrics
} from "./orchestrator.js";
import type { AnnIndexStats, AnnSearchOptions, AnnSearchResult } from "./types.js";
import type { EmbeddingVector } from "../embedding/types.js";
import {
  annProviderSatisfiesCapabilities,
  normalizeAnnProviderCapabilities,
  type AnnProviderCapabilityRequirement,
  type AnnProviderCapabilities,
  type CapableAnnProviderCandidate
} from "./capabilities.js";
import type { CapabilityAwareAnnExecutionResult } from "./capability-runner.js";
import {
  filterAnnProvidersByDeployment,
  type AnnDeploymentRoutingOptions
} from "./deployment-routing.js";

export interface CapabilityAwareAnnOrchestratorOptions extends AnnOrchestratorOptions {
  requirement: AnnProviderCapabilityRequirement;
  deployment?: Omit<AnnDeploymentRoutingOptions, "requirement">;
}

function matchingCandidates(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): CapableAnnProviderCandidate[] {
  if (options.deployment !== undefined) {
    return filterAnnProvidersByDeployment(candidates, {
      ...options.deployment,
      requirement: options.requirement
    });
  }

  return candidates.filter((candidate) =>
    annProviderSatisfiesCapabilities(candidate.capabilities, options.requirement)
  );
}

function requireMatchingCandidates(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): CapableAnnProviderCandidate[] {
  const matches = matchingCandidates(candidates, options);

  if (matches.length === 0) {
    throw new Error("No ANN provider satisfies the required capabilities and deployment policy");
  }

  return matches;
}

function capabilitiesFor(
  candidates: readonly CapableAnnProviderCandidate[],
  providerName: string
): Required<AnnProviderCapabilities> {
  const candidate = candidates.find((item) => item.name === providerName);
  return normalizeAnnProviderCapabilities(candidate?.capabilities);
}

export class CapabilityAwareAnnOrchestrator {
  private readonly candidates: CapableAnnProviderCandidate[];
  private readonly orchestrator: AnnProviderOrchestrator;

  constructor(candidates: readonly CapableAnnProviderCandidate[], options: CapabilityAwareAnnOrchestratorOptions) {
    this.candidates = requireMatchingCandidates(candidates, options);
    this.orchestrator = new AnnProviderOrchestrator(this.candidates, options);
  }

  async upsert(
    clusterId: string,
    vector: EmbeddingVector
  ): Promise<CapabilityAwareAnnExecutionResult<void>> {
    const execution = await this.orchestrator.upsertWithProvider(clusterId, vector);

    return {
      provider: execution.provider,
      capabilities: capabilitiesFor(this.candidates, execution.provider),
      result: execution.result
    };
  }

  async delete(clusterId: string): Promise<CapabilityAwareAnnExecutionResult<boolean>> {
    const execution = await this.orchestrator.deleteWithProvider(clusterId);

    return {
      provider: execution.provider,
      capabilities: capabilitiesFor(this.candidates, execution.provider),
      result: execution.result
    };
  }

  async search(
    vector: EmbeddingVector,
    options?: AnnSearchOptions
  ): Promise<CapabilityAwareAnnExecutionResult<AnnSearchResult[]>> {
    const execution = await this.orchestrator.searchWithProvider(vector, options);

    return {
      provider: execution.provider,
      capabilities: capabilitiesFor(this.candidates, execution.provider),
      result: execution.result
    };
  }

  async stats(): Promise<CapabilityAwareAnnExecutionResult<AnnIndexStats>> {
    const execution = await this.orchestrator.statsWithProvider();

    return {
      provider: execution.provider,
      capabilities: capabilitiesFor(this.candidates, execution.provider),
      result: execution.result
    };
  }

  getRetryMetrics(): AnnRetryMetrics {
    return this.orchestrator.getRetryMetrics();
  }

  getProviderHealth(): AnnProviderHealthState[] {
    return this.orchestrator.getProviderHealth();
  }

  getCircuitState(): AnnCircuitState {
    return this.orchestrator.getCircuitState();
  }

  getRecentEvents(): AnnProviderEvent[] {
    return this.orchestrator.getRecentEvents();
  }

  async probeProviders(): Promise<AnnProviderProbeResult[]> {
    return this.orchestrator.probeProviders();
  }
}

export function createCapabilityAwareAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): CapabilityAwareAnnOrchestrator {
  return new CapabilityAwareAnnOrchestrator(candidates, options);
}
