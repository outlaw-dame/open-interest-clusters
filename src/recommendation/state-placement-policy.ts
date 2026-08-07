import {
  evaluateRecommendationStorageAuthority,
  isRecommendationProcessingBoundary,
  isRecommendationStorageAuthority,
  type RecommendationProcessingBoundary,
  type RecommendationStorageAuthority,
  type RecommendationStorageAuthorityReason
} from "./storage-authority.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export const RECOMMENDATION_STATE_DOMAINS = [
  "interest_profile",
  "seen_history",
  "dismissal_history",
  "feedback_history",
  "bandit_state",
  "label_evidence",
  "profile_embedding",
  "candidate_cache",
  "explanation_cache",
  "aggregate_statistics"
] as const;

export type RecommendationStateDomain = typeof RECOMMENDATION_STATE_DOMAINS[number];

export const RECOMMENDATION_STATE_PERSISTENCE_MODES = ["ephemeral", "persistent"] as const;
export type RecommendationStatePersistenceMode =
  typeof RECOMMENDATION_STATE_PERSISTENCE_MODES[number];

export const RECOMMENDATION_STATE_PLACEMENT_REASONS = [
  "state.allow.device_local_first",
  "state.allow.user_controlled_remote",
  "state.allow.aggregate_statistics",
  "state.deny.storage_authority",
  "state.deny.personal_state_provider_controlled",
  "state.deny.aggregate_domain_mismatch",
  "state.deny.local_adapter_requires_network",
  "state.deny.local_adapter_not_offline_capable",
  "state.deny.persistent_state_not_user_deletable",
  "state.deny.user_state_not_exportable"
] as const;

export type RecommendationStatePlacementReason =
  typeof RECOMMENDATION_STATE_PLACEMENT_REASONS[number];

export interface RecommendationStateDomainMetadata {
  domain: RecommendationStateDomain;
  subjectLevel: boolean;
  userPreferenceState: boolean;
  rebuildable: boolean;
}

export interface RecommendationStateStorageAdapterManifest {
  adapterId: string;
  domains: readonly RecommendationStateDomain[];
  authority: RecommendationStorageAuthority;
  processingBoundary: RecommendationProcessingBoundary;
  persistence: RecommendationStatePersistenceMode;
  requiresNetwork: boolean;
  supportsOffline: boolean;
  userExportable: boolean;
  userDeletable: boolean;
  encryptedAtRest: boolean;
}

export interface RecommendationStatePlacementEvaluation {
  domain: RecommendationStateDomain;
  decision: "allow" | "deny";
  reason: RecommendationStatePlacementReason;
  authorityReason?: RecommendationStorageAuthorityReason;
}

export interface RecommendationStateStorageManifestEvaluation {
  adapterId: string;
  decision: "allow" | "deny";
  evaluations: readonly RecommendationStatePlacementEvaluation[];
}

const DOMAIN_SET = new Set<string>(RECOMMENDATION_STATE_DOMAINS);
const PERSISTENCE_SET = new Set<string>(RECOMMENDATION_STATE_PERSISTENCE_MODES);
const MAX_ADAPTER_ID_LENGTH = 128;

const DOMAIN_METADATA: Readonly<Record<RecommendationStateDomain, RecommendationStateDomainMetadata>> =
  Object.freeze({
    interest_profile: Object.freeze({ domain: "interest_profile", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    seen_history: Object.freeze({ domain: "seen_history", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    dismissal_history: Object.freeze({ domain: "dismissal_history", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    feedback_history: Object.freeze({ domain: "feedback_history", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    bandit_state: Object.freeze({ domain: "bandit_state", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    label_evidence: Object.freeze({ domain: "label_evidence", subjectLevel: true, userPreferenceState: true, rebuildable: false }),
    profile_embedding: Object.freeze({ domain: "profile_embedding", subjectLevel: true, userPreferenceState: false, rebuildable: true }),
    candidate_cache: Object.freeze({ domain: "candidate_cache", subjectLevel: true, userPreferenceState: false, rebuildable: true }),
    explanation_cache: Object.freeze({ domain: "explanation_cache", subjectLevel: true, userPreferenceState: false, rebuildable: true }),
    aggregate_statistics: Object.freeze({ domain: "aggregate_statistics", subjectLevel: false, userPreferenceState: false, rebuildable: true })
  });

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateAdapterId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_ADAPTER_ID_LENGTH ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError("Invalid recommendation state storage adapter ID.");
  }
  return value;
}

export function isRecommendationStateDomain(value: unknown): value is RecommendationStateDomain {
  return typeof value === "string" && DOMAIN_SET.has(value);
}

export function getRecommendationStateDomainMetadata(
  domain: RecommendationStateDomain
): RecommendationStateDomainMetadata {
  if (!isRecommendationStateDomain(domain)) {
    throw new TypeError("Invalid recommendation state domain.");
  }
  return DOMAIN_METADATA[domain];
}

export function normalizeRecommendationStateStorageAdapterManifest(
  input: RecommendationStateStorageAdapterManifest
): RecommendationStateStorageAdapterManifest {
  if (
    !isPlainRecord(input) ||
    !Array.isArray(input.domains) ||
    input.domains.length === 0 ||
    input.domains.some((domain) => !isRecommendationStateDomain(domain)) ||
    new Set(input.domains).size !== input.domains.length ||
    !isRecommendationStorageAuthority(input.authority) ||
    !isRecommendationProcessingBoundary(input.processingBoundary) ||
    typeof input.persistence !== "string" ||
    !PERSISTENCE_SET.has(input.persistence) ||
    typeof input.requiresNetwork !== "boolean" ||
    typeof input.supportsOffline !== "boolean" ||
    typeof input.userExportable !== "boolean" ||
    typeof input.userDeletable !== "boolean" ||
    typeof input.encryptedAtRest !== "boolean"
  ) {
    throw new TypeError("Invalid recommendation state storage adapter manifest.");
  }

  return Object.freeze({
    adapterId: validateAdapterId(input.adapterId),
    domains: Object.freeze([...input.domains]),
    authority: input.authority,
    processingBoundary: input.processingBoundary,
    persistence: input.persistence,
    requiresNetwork: input.requiresNetwork,
    supportsOffline: input.supportsOffline,
    userExportable: input.userExportable,
    userDeletable: input.userDeletable,
    encryptedAtRest: input.encryptedAtRest
  });
}

export function evaluateRecommendationStatePlacement(
  manifestInput: RecommendationStateStorageAdapterManifest,
  domainInput: RecommendationStateDomain
): RecommendationStatePlacementEvaluation {
  const manifest = normalizeRecommendationStateStorageAdapterManifest(manifestInput);
  if (!isRecommendationStateDomain(domainInput) || !manifest.domains.includes(domainInput)) {
    throw new TypeError("Recommendation state domain is not declared by the storage adapter.");
  }
  const metadata = DOMAIN_METADATA[domainInput];
  const authority = evaluateRecommendationStorageAuthority({
    authority: manifest.authority,
    processingBoundary: manifest.processingBoundary,
    subjectLevel: metadata.subjectLevel
  });

  if (authority.decision === "deny") {
    return Object.freeze({
      domain: domainInput,
      decision: "deny",
      reason: metadata.subjectLevel && manifest.authority === "provider_owned"
        ? "state.deny.personal_state_provider_controlled"
        : "state.deny.storage_authority",
      authorityReason: authority.reason
    });
  }

  if (domainInput === "aggregate_statistics") {
    return manifest.authority === "shared_operator" && manifest.processingBoundary === "aggregate_only"
      ? Object.freeze({ domain: domainInput, decision: "allow", reason: "state.allow.aggregate_statistics", authorityReason: authority.reason })
      : Object.freeze({ domain: domainInput, decision: "deny", reason: "state.deny.aggregate_domain_mismatch", authorityReason: authority.reason });
  }

  if (manifest.authority === "device_owned") {
    if (manifest.requiresNetwork) {
      return Object.freeze({ domain: domainInput, decision: "deny", reason: "state.deny.local_adapter_requires_network", authorityReason: authority.reason });
    }
    if (!manifest.supportsOffline) {
      return Object.freeze({ domain: domainInput, decision: "deny", reason: "state.deny.local_adapter_not_offline_capable", authorityReason: authority.reason });
    }
  }

  if (manifest.persistence === "persistent" && !manifest.userDeletable) {
    return Object.freeze({
      domain: domainInput,
      decision: "deny",
      reason: "state.deny.persistent_state_not_user_deletable",
      authorityReason: authority.reason
    });
  }

  if (manifest.persistence === "persistent" && metadata.userPreferenceState && !manifest.userExportable) {
    return Object.freeze({
      domain: domainInput,
      decision: "deny",
      reason: "state.deny.user_state_not_exportable",
      authorityReason: authority.reason
    });
  }

  return Object.freeze({
    domain: domainInput,
    decision: "allow",
    reason: manifest.authority === "device_owned"
      ? "state.allow.device_local_first"
      : "state.allow.user_controlled_remote",
    authorityReason: authority.reason
  });
}

export function evaluateRecommendationStateStorageManifest(
  input: RecommendationStateStorageAdapterManifest
): RecommendationStateStorageManifestEvaluation {
  const manifest = normalizeRecommendationStateStorageAdapterManifest(input);
  const evaluations = Object.freeze(
    manifest.domains.map((domain) => evaluateRecommendationStatePlacement(manifest, domain))
  );
  return Object.freeze({
    adapterId: manifest.adapterId,
    decision: evaluations.every((evaluation) => evaluation.decision === "allow") ? "allow" : "deny",
    evaluations
  });
}

export function assertRecommendationStateStorageManifest(
  input: RecommendationStateStorageAdapterManifest
): RecommendationStateStorageAdapterManifest {
  const manifest = normalizeRecommendationStateStorageAdapterManifest(input);
  const evaluation = evaluateRecommendationStateStorageManifest(manifest);
  if (evaluation.decision === "deny") {
    throw new TypeError("Recommendation state storage adapter violates placement policy.");
  }
  return manifest;
}
