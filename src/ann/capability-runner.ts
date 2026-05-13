import type { AnnIndexStats, AnnSearchOptions, AnnSearchResult } from "./types.js";
import type { EmbeddingVector } from "../embedding/types.js";
import {
  annProviderSatisfiesCapabilities,
  normalizeAnnProviderCapabilities,
  type AnnProviderCapabilityRequirement,
  type AnnProviderCapabilities,
  type CapableAnnProviderCandidate
} from "./capabilities.js";

export interface CapabilityAwareAnnSelection {
  provider: string;
  capabilities: Required<AnnProviderCapabilities>;
}

export interface CapabilityAwareAnnExecutionResult<T> extends CapabilityAwareAnnSelection {
  result: T;
}

function sortedCandidates(candidates: readonly CapableAnnProviderCandidate[]): CapableAnnProviderCandidate[] {
  return [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

function selectCandidate(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): CapableAnnProviderCandidate {
  const candidate = sortedCandidates(candidates).find((item) =>
    annProviderSatisfiesCapabilities(item.capabilities, requirement)
  );

  if (candidate === undefined) {
    throw new Error("No ANN provider satisfies the required capabilities");
  }

  return candidate;
}

function selectionFor(candidate: CapableAnnProviderCandidate): CapabilityAwareAnnSelection {
  return {
    provider: candidate.name,
    capabilities: normalizeAnnProviderCapabilities(candidate.capabilities)
  };
}

export function selectCapabilityAwareAnnProvider(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): CapabilityAwareAnnSelection {
  return selectionFor(selectCandidate(candidates, requirement));
}

export async function searchWithAnnCapabilities(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement,
  vector: EmbeddingVector,
  options?: AnnSearchOptions
): Promise<CapabilityAwareAnnExecutionResult<AnnSearchResult[]>> {
  const candidate = selectCandidate(candidates, requirement);

  return {
    ...selectionFor(candidate),
    result: await candidate.provider.search(vector, options)
  };
}

export async function statsWithAnnCapabilities(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): Promise<CapabilityAwareAnnExecutionResult<AnnIndexStats>> {
  const candidate = selectCandidate(candidates, requirement);

  return {
    ...selectionFor(candidate),
    result: await candidate.provider.stats()
  };
}
