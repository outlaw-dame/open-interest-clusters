import { AnnProviderOrchestrator, type AnnOrchestratorOptions } from "./orchestrator.js";
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

export interface CapabilityAwareAnnOrchestratorOptions extends AnnOrchestratorOptions {
  requirement: AnnProviderCapabilityRequirement;
}

function matchingCandidates(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): CapableAnnProviderCandidate[] {
  return candidates.filter((candidate) =>
    annProviderSatisfiesCapabilities(candidate.capabilities, requirement)
  );
}

function requireMatchingCandidates(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): CapableAnnProviderCandidate[] {
  const matches = matchingCandidates(candidates, requirement);

  if (matches.length === 0) {
    throw new Error("No ANN provider satisfies the required capabilities");
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
    this.candidates = requireMatchingCandidates(candidates, options.requirement);
    this.orchestrator = new AnnProviderOrchestrator(this.candidates, options);
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

  getOrchestrator(): AnnProviderOrchestrator {
    return this.orchestrator;
  }
}

export function createCapabilityAwareAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): CapabilityAwareAnnOrchestrator {
  return new CapabilityAwareAnnOrchestrator(candidates, options);
}
