import {
  createCapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestratorOptions
} from "./capability-orchestrator.js";
import type { CapableAnnProviderCandidate } from "./capabilities.js";
import type { AnnDeploymentRoutingOptions } from "./deployment-routing.js";

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

  getCurrent(): CapabilityAwareAnnOrchestrator {
    return this.current;
  }
}

export function createAdaptiveCapabilityAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: CapabilityAwareAnnOrchestratorOptions
): AdaptiveCapabilityAnnOrchestrator {
  return new AdaptiveCapabilityAnnOrchestrator(candidates, options);
}
