import {
  createCapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestratorOptions
} from "./capability-orchestrator.js";
import type { CapableAnnProviderCandidate } from "./capabilities.js";
import type { AnnDeploymentRoutingOptions } from "./deployment-routing.js";

export type AnnDeploymentProfile = "browser" | "server" | "edge" | "hybrid";

export function annDeploymentForProfile(
  profile: AnnDeploymentProfile
): Omit<AnnDeploymentRoutingOptions, "requirement"> {
  if (profile === "browser") return { environment: "browser", preferLocalFirst: true };
  if (profile === "server") return { environment: "server", requireDurableWrites: true, allowEphemeralFallback: false };
  if (profile === "edge") return { environment: "edge", allowEphemeralFallback: true };
  return { environment: "hybrid" };
}

export function createProfiledAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  profile: AnnDeploymentProfile,
  options: Omit<CapabilityAwareAnnOrchestratorOptions, "deployment">
): CapabilityAwareAnnOrchestrator {
  return createCapabilityAwareAnnOrchestrator(candidates, {
    ...options,
    deployment: annDeploymentForProfile(profile)
  });
}
