import type { AnnOrchestratorOptions } from "./orchestrator.js";
import type { AnnProviderCapabilityRequirement, CapableAnnProviderCandidate } from "./capabilities.js";
import type { AnnDeploymentRoutingOptions } from "./deployment-routing.js";
import { annDeploymentForProfile, type AnnDeploymentProfile } from "./deployment-profiles.js";
import {
  createCapabilityAwareAnnOrchestrator,
  type CapabilityAwareAnnOrchestrator
} from "./capability-orchestrator.js";
import {
  createAdaptiveCapabilityAnnOrchestrator,
  type AdaptiveCapabilityAnnOrchestrator
} from "./adaptive-orchestrator.js";

export interface AnnDeploymentConfig {
  profile: AnnDeploymentProfile;
  requirement: AnnProviderCapabilityRequirement;
  deployment: Omit<AnnDeploymentRoutingOptions, "requirement">;
}

export interface AnnDeploymentConfigInput {
  profile?: unknown;
  requirement?: unknown;
  deployment?: unknown;
}

export interface ConfiguredAnnOrchestratorOptions extends AnnOrchestratorOptions {
  config: AnnDeploymentConfigInput;
}

const PROFILES: readonly AnnDeploymentProfile[] = ["browser", "server", "edge", "hybrid"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfile(value: unknown): value is AnnDeploymentProfile {
  return typeof value === "string" && PROFILES.includes(value as AnnDeploymentProfile);
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`ANN deployment config field ${key} must be boolean`);
  return value;
}

function parseRequirement(value: unknown): AnnProviderCapabilityRequirement {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("ANN deployment config requirement must be an object");

  const requirement: AnnProviderCapabilityRequirement = {};

  if (value.persistence !== undefined) {
    if (value.persistence !== "none" && value.persistence !== "local" && value.persistence !== "durable") {
      throw new Error("ANN deployment config requirement.persistence is invalid");
    }
    requirement.persistence = value.persistence;
  }

  for (const key of ["approximateSearch", "metadataFiltering", "namespaces", "snapshots", "transactions", "hybridSparseDense"] as const) {
    const booleanValue = readBoolean(value, key);
    if (booleanValue !== undefined) requirement[key] = booleanValue;
  }

  return requirement;
}

function parseDeployment(value: unknown): Omit<AnnDeploymentRoutingOptions, "requirement"> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("ANN deployment config deployment must be an object");

  const deployment: Omit<AnnDeploymentRoutingOptions, "requirement"> = {};

  if (value.environment !== undefined) {
    if (value.environment !== "browser" && value.environment !== "server" && value.environment !== "edge" && value.environment !== "hybrid") {
      throw new Error("ANN deployment config deployment.environment is invalid");
    }
    deployment.environment = value.environment;
  }

  const allowEphemeralFallback = readBoolean(value, "allowEphemeralFallback");
  if (allowEphemeralFallback !== undefined) deployment.allowEphemeralFallback = allowEphemeralFallback;

  const preferLocalFirst = readBoolean(value, "preferLocalFirst");
  if (preferLocalFirst !== undefined) deployment.preferLocalFirst = preferLocalFirst;

  const requireDurableWrites = readBoolean(value, "requireDurableWrites");
  if (requireDurableWrites !== undefined) deployment.requireDurableWrites = requireDurableWrites;

  return deployment;
}

export function validateAnnDeploymentConfig(input: AnnDeploymentConfigInput): AnnDeploymentConfig {
  const profile = input.profile ?? "hybrid";
  if (!isProfile(profile)) throw new Error("ANN deployment config profile is invalid");

  const requirement = parseRequirement(input.requirement);
  const deployment = {
    ...annDeploymentForProfile(profile),
    ...parseDeployment(input.deployment)
  };

  if (deployment.requireDurableWrites === true && deployment.environment === "browser") {
    throw new Error("ANN deployment config cannot require durable writes in browser profile");
  }

  return {
    profile,
    requirement,
    deployment
  };
}

export function createConfiguredCapabilityAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: ConfiguredAnnOrchestratorOptions
): CapabilityAwareAnnOrchestrator {
  const { config, ...orchestratorOptions } = options;
  const validated = validateAnnDeploymentConfig(config);

  return createCapabilityAwareAnnOrchestrator(candidates, {
    ...orchestratorOptions,
    requirement: validated.requirement,
    deployment: validated.deployment
  });
}

export function createConfiguredAdaptiveAnnOrchestrator(
  candidates: readonly CapableAnnProviderCandidate[],
  options: ConfiguredAnnOrchestratorOptions
): AdaptiveCapabilityAnnOrchestrator {
  const { config, ...orchestratorOptions } = options;
  const validated = validateAnnDeploymentConfig(config);

  return createAdaptiveCapabilityAnnOrchestrator(candidates, {
    ...orchestratorOptions,
    requirement: validated.requirement,
    deployment: validated.deployment
  });
}
