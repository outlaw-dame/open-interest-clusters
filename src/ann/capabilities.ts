import type { AnnProviderCandidate } from "./orchestrator.js";

export type AnnPersistenceCapability = "none" | "local" | "durable";

export interface AnnProviderCapabilities {
  persistence?: AnnPersistenceCapability;
  approximateSearch?: boolean;
  metadataFiltering?: boolean;
  namespaces?: boolean;
  snapshots?: boolean;
  transactions?: boolean;
  hybridSparseDense?: boolean;
}

export interface AnnProviderCapabilityRequirement extends AnnProviderCapabilities {}

export interface CapableAnnProviderCandidate extends AnnProviderCandidate {
  capabilities?: AnnProviderCapabilities;
}

export interface AnnProviderCapabilityState {
  provider: string;
  priority: number;
  capabilities: Required<AnnProviderCapabilities>;
}

export interface AnnCapabilitySelection {
  provider: string;
  capabilities: Required<AnnProviderCapabilities>;
}

const DEFAULT_CAPABILITIES: Required<AnnProviderCapabilities> = {
  persistence: "none",
  approximateSearch: false,
  metadataFiltering: false,
  namespaces: false,
  snapshots: false,
  transactions: false,
  hybridSparseDense: false
};

const PERSISTENCE_RANK: Record<AnnPersistenceCapability, number> = {
  none: 0,
  local: 1,
  durable: 2
};

export function normalizeAnnProviderCapabilities(
  capabilities: AnnProviderCapabilities | undefined
): Required<AnnProviderCapabilities> {
  return {
    ...DEFAULT_CAPABILITIES,
    ...capabilities
  };
}

function persistenceSatisfies(
  actual: AnnPersistenceCapability,
  required: AnnPersistenceCapability
): boolean {
  return PERSISTENCE_RANK[actual] >= PERSISTENCE_RANK[required];
}

export function annProviderSatisfiesCapabilities(
  capabilities: AnnProviderCapabilities | undefined,
  requirement: AnnProviderCapabilityRequirement
): boolean {
  const normalized = normalizeAnnProviderCapabilities(capabilities);

  if (requirement.persistence !== undefined && !persistenceSatisfies(normalized.persistence, requirement.persistence)) {
    return false;
  }

  if (requirement.approximateSearch === true && !normalized.approximateSearch) return false;
  if (requirement.metadataFiltering === true && !normalized.metadataFiltering) return false;
  if (requirement.namespaces === true && !normalized.namespaces) return false;
  if (requirement.snapshots === true && !normalized.snapshots) return false;
  if (requirement.transactions === true && !normalized.transactions) return false;
  if (requirement.hybridSparseDense === true && !normalized.hybridSparseDense) return false;

  return true;
}

export function getAnnProviderCapabilities(
  candidates: readonly CapableAnnProviderCandidate[]
): AnnProviderCapabilityState[] {
  return candidates.map((candidate) => ({
    provider: candidate.name,
    priority: candidate.priority ?? 0,
    capabilities: normalizeAnnProviderCapabilities(candidate.capabilities)
  }));
}

export function selectAnnProviderForCapabilities(
  candidates: readonly CapableAnnProviderCandidate[],
  requirement: AnnProviderCapabilityRequirement
): AnnCapabilitySelection | null {
  const sorted = [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const candidate = sorted.find((item) => annProviderSatisfiesCapabilities(item.capabilities, requirement));

  if (candidate === undefined) {
    return null;
  }

  return {
    provider: candidate.name,
    capabilities: normalizeAnnProviderCapabilities(candidate.capabilities)
  };
}
