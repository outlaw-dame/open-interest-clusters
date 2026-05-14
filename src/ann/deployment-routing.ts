import {
  annProviderSatisfiesCapabilities,
  normalizeAnnProviderCapabilities,
  type AnnProviderCapabilities,
  type AnnProviderCapabilityRequirement,
  type CapableAnnProviderCandidate
} from "./capabilities.js";

export type AnnDeploymentEnvironment = "browser" | "server" | "hybrid" | "edge";

export interface AnnDeploymentRoutingOptions {
  environment?: AnnDeploymentEnvironment;
  requirement?: AnnProviderCapabilityRequirement;
  allowEphemeralFallback?: boolean;
  preferLocalFirst?: boolean;
  requireDurableWrites?: boolean;
}

export interface AnnDeploymentSelection {
  provider: string;
  priority: number;
  capabilities: Required<AnnProviderCapabilities>;
  environment: AnnDeploymentEnvironment;
}

interface NormalizedRoutingOptions extends Required<Omit<AnnDeploymentRoutingOptions, "requirement">> {
  requirement: AnnProviderCapabilityRequirement;
}

function normalizeRoutingOptions(options: AnnDeploymentRoutingOptions = {}): NormalizedRoutingOptions {
  return {
    environment: options.environment ?? "hybrid",
    requirement: options.requirement ?? {},
    allowEphemeralFallback: options.allowEphemeralFallback ?? true,
    preferLocalFirst: options.preferLocalFirst ?? false,
    requireDurableWrites: options.requireDurableWrites ?? false
  };
}

function environmentAllows(
  capabilities: Required<AnnProviderCapabilities>,
  options: NormalizedRoutingOptions
): boolean {
  if (!options.allowEphemeralFallback && capabilities.persistence === "none") return false;
  if (options.requireDurableWrites && capabilities.persistence !== "durable") return false;

  if (options.environment === "browser") {
    return capabilities.persistence === "local" || (options.allowEphemeralFallback && capabilities.persistence === "none");
  }

  if (options.environment === "server") {
    return capabilities.persistence === "durable" || (options.allowEphemeralFallback && capabilities.persistence === "none");
  }

  if (options.environment === "edge") {
    return capabilities.persistence === "none" || capabilities.persistence === "local";
  }

  return true;
}

function environmentBoost(
  capabilities: Required<AnnProviderCapabilities>,
  options: NormalizedRoutingOptions
): number {
  if (options.preferLocalFirst && capabilities.persistence === "local") return 1_000;
  if (options.environment === "server" && capabilities.persistence === "durable") return 1_000;
  if (options.environment === "browser" && capabilities.persistence === "local") return 1_000;
  if (options.environment === "edge" && capabilities.persistence === "none") return 500;
  return 0;
}

function scoreCandidate(candidate: CapableAnnProviderCandidate, options: NormalizedRoutingOptions): number {
  return (candidate.priority ?? 0) + environmentBoost(normalizeAnnProviderCapabilities(candidate.capabilities), options);
}

export function filterAnnProvidersByDeployment(
  candidates: readonly CapableAnnProviderCandidate[],
  optionsInput?: AnnDeploymentRoutingOptions
): CapableAnnProviderCandidate[] {
  const options = normalizeRoutingOptions(optionsInput);

  return candidates
    .filter((candidate) => {
      const capabilities = normalizeAnnProviderCapabilities(candidate.capabilities);
      return environmentAllows(capabilities, options) && annProviderSatisfiesCapabilities(capabilities, options.requirement);
    })
    .sort((a, b) => scoreCandidate(b, options) - scoreCandidate(a, options));
}

export function selectAnnProviderByDeployment(
  candidates: readonly CapableAnnProviderCandidate[],
  optionsInput?: AnnDeploymentRoutingOptions
): AnnDeploymentSelection | null {
  const options = normalizeRoutingOptions(optionsInput);
  const selected = filterAnnProvidersByDeployment(candidates, options)[0];

  if (selected === undefined) return null;

  return {
    provider: selected.name,
    priority: selected.priority ?? 0,
    capabilities: normalizeAnnProviderCapabilities(selected.capabilities),
    environment: options.environment
  };
}
