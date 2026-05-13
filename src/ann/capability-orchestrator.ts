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
    const result = await this.orchestrator.search(vector, options);
    const selection = await this.orchestrator.selection();

    return {
      provider: selection.activeProvider,
      capabilities: capabilitiesFor(this.candidates, selection.activeProvider),
      result
    };
  }

  async stats(): Promise<CapabilityAwareAnnExecutionResult<AnnIndexStats>> {
    const result = await this.orchestrator.stats();
    const selection = await this.orchestrator.selection();

    return {
      provider: selection.activeProvider,
      capabilities: capabilitiesFor(this.candidates, selection.activeProvider),
      result
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
