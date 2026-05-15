export const RECOMMENDATION_DATA_USES = [
  "ranking",
  "embeddings",
  "local_personalization",
  "server_personalization",
  "analytics"
] as const;

export type RecommendationDataUse = typeof RECOMMENDATION_DATA_USES[number];

export const RECOMMENDATION_SOURCE_VISIBILITIES = [
  "public",
  "unlisted",
  "followers_only",
  "mentioned_only",
  "mutuals_only",
  "local_only",
  "acl_controlled",
  "atproto_public_repo",
  "unknown"
] as const;

export type RecommendationSourceVisibility = typeof RECOMMENDATION_SOURCE_VISIBILITIES[number];

export const RECOMMENDATION_ACCESS_BASES = [
  "public_web",
  "authenticated_api",
  "follower_relationship",
  "mentioned_recipient",
  "mutual_relationship",
  "owner",
  "solid_acl_read",
  "solid_acl_control",
  "atproto_public_repo",
  "oauth_scope",
  "provider_policy",
  "unknown"
] as const;

export type RecommendationAccessBasis = typeof RECOMMENDATION_ACCESS_BASES[number];

export const RECOMMENDATION_PROTOCOLS = [
  "activitypub",
  "activitypods",
  "atproto",
  "app_local",
  "unknown"
] as const;

export type RecommendationProtocol = typeof RECOMMENDATION_PROTOCOLS[number];

export const RECOMMENDATION_DERIVED_DATA_TARGETS = [
  "profile",
  "embeddings",
  "source_references",
  "event_history",
  "candidate_cache"
] as const;

export type RecommendationDerivedDataTarget = typeof RECOMMENDATION_DERIVED_DATA_TARGETS[number];

export type RecommendationConsentDecision = "allow" | "deny";

export type RecommendationConsentReasonCode =
  | "consent.allow.explicit"
  | "consent.deny.default"
  | "consent.deny.invalid_policy"
  | "consent.deny.invalid_request"
  | "consent.deny.revoked"
  | "consent.deny.deleted"
  | "consent.deny.use_not_allowed"
  | "consent.deny.subject_mismatch"
  | "consent.deny.server_processing_not_allowed"
  | "access.deny.visibility_scope"
  | "access.deny.acl_required"
  | "access.deny.access_basis_unknown"
  | "access.deny.protocol_scope_unknown"
  | "policy.deny.provider_policy"
  | "safety.deny.private_data_use_not_allowed"
  | "safety.deny.third_party_private_data";

export interface RecommendationConsentPolicy {
  subjectId: string;
  allowedDataUses: readonly RecommendationDataUse[];
  privateDataUses?: readonly RecommendationDataUse[];
  thirdPartyPrivateDataUses?: readonly RecommendationDataUse[];
  serverSideDataUses?: readonly RecommendationDataUse[];
  revokedAt?: string;
  deleteDerivedDataRequestedAt?: string;
}

export interface RecommendationConsentRequest {
  subjectId: string;
  dataUse: RecommendationDataUse;
  protocol: RecommendationProtocol;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface PrivacySafeRecommendationConsentEvent {
  decision: RecommendationConsentDecision;
  reason: RecommendationConsentReasonCode;
  dataUse: RecommendationDataUse;
  protocol: RecommendationProtocol;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData: boolean;
  containsThirdPartyData: boolean;
  serverSideProcessing: boolean;
}

export interface RecommendationConsentEvaluation extends PrivacySafeRecommendationConsentEvent {
  auditEvent: PrivacySafeRecommendationConsentEvent;
}

export interface RecommendationDerivedDataDeletionIntent {
  subjectId: string;
  requestedAt: string;
  scope: "recommendation_derived_data";
  targets: readonly RecommendationDerivedDataTarget[];
}

const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKnownDataUse(value: unknown): value is RecommendationDataUse {
  return typeof value === "string" && DATA_USE_SET.has(value);
}

function isKnownProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
}

function isKnownVisibility(value: unknown): value is RecommendationSourceVisibility {
  return typeof value === "string" && VISIBILITY_SET.has(value);
}

function isKnownAccessBasis(value: unknown): value is RecommendationAccessBasis {
  return typeof value === "string" && ACCESS_BASIS_SET.has(value);
}

function includesUse(uses: readonly RecommendationDataUse[] | undefined, dataUse: RecommendationDataUse): boolean {
  return Array.isArray(uses) && uses.includes(dataUse);
}

function hasInvalidAllowedUse(uses: unknown): boolean {
  return uses !== undefined && (!Array.isArray(uses) || uses.some((use) => !isKnownDataUse(use)));
}

function isValidPolicy(policy: unknown): policy is RecommendationConsentPolicy {
  if (policy === null || typeof policy !== "object") {
    return false;
  }

  const candidate = policy as Partial<RecommendationConsentPolicy>;

  return (
    isNonEmptyString(candidate.subjectId) &&
    Array.isArray(candidate.allowedDataUses) &&
    candidate.allowedDataUses.every(isKnownDataUse) &&
    !hasInvalidAllowedUse(candidate.privateDataUses) &&
    !hasInvalidAllowedUse(candidate.thirdPartyPrivateDataUses) &&
    !hasInvalidAllowedUse(candidate.serverSideDataUses)
  );
}

function isValidRequest(request: unknown): request is RecommendationConsentRequest {
  if (request === null || typeof request !== "object") {
    return false;
  }

  const candidate = request as Partial<RecommendationConsentRequest>;

  return (
    isNonEmptyString(candidate.subjectId) &&
    isKnownDataUse(candidate.dataUse) &&
    isKnownProtocol(candidate.protocol) &&
    isKnownVisibility(candidate.sourceVisibility) &&
    isKnownAccessBasis(candidate.accessBasis)
  );
}

function isPrivateVisibility(visibility: RecommendationSourceVisibility): boolean {
  return (
    visibility === "followers_only" ||
    visibility === "mentioned_only" ||
    visibility === "mutuals_only" ||
    visibility === "local_only" ||
    visibility === "acl_controlled"
  );
}

function deriveEffectivePrivateData(request: RecommendationConsentRequest): boolean {
  return request.containsPrivateData === true || isPrivateVisibility(request.sourceVisibility);
}

function visibilityAllowsAccess(
  visibility: RecommendationSourceVisibility,
  accessBasis: RecommendationAccessBasis
): RecommendationConsentReasonCode | "allow" {
  if (visibility === "unknown") {
    return "access.deny.visibility_scope";
  }

  if (accessBasis === "unknown") {
    return "access.deny.access_basis_unknown";
  }

  switch (visibility) {
    case "public":
    case "unlisted":
    case "atproto_public_repo":
      return "allow";
    case "followers_only":
      return accessBasis === "follower_relationship" ||
        accessBasis === "mutual_relationship" ||
        accessBasis === "owner"
        ? "allow"
        : "access.deny.visibility_scope";
    case "mentioned_only":
      return accessBasis === "mentioned_recipient" || accessBasis === "owner"
        ? "allow"
        : "access.deny.visibility_scope";
    case "mutuals_only":
      return accessBasis === "mutual_relationship" || accessBasis === "owner"
        ? "allow"
        : "access.deny.visibility_scope";
    case "local_only":
      return accessBasis === "provider_policy" || accessBasis === "owner"
        ? "allow"
        : "access.deny.visibility_scope";
    case "acl_controlled":
      return accessBasis === "solid_acl_read" ||
        accessBasis === "solid_acl_control" ||
        accessBasis === "owner"
        ? "allow"
        : "access.deny.acl_required";
  }
}

function createPrivacySafeConsentEvent(
  request: RecommendationConsentRequest,
  decision: RecommendationConsentDecision,
  reason: RecommendationConsentReasonCode,
  effectivePrivateData = deriveEffectivePrivateData(request)
): PrivacySafeRecommendationConsentEvent {
  return Object.freeze({
    decision,
    reason,
    dataUse: request.dataUse,
    protocol: request.protocol,
    sourceVisibility: request.sourceVisibility,
    accessBasis: request.accessBasis,
    containsPrivateData: effectivePrivateData,
    containsThirdPartyData: request.containsThirdPartyData === true,
    serverSideProcessing: request.serverSideProcessing === true
  });
}

function createEvaluation(
  request: RecommendationConsentRequest,
  decision: RecommendationConsentDecision,
  reason: RecommendationConsentReasonCode,
  effectivePrivateData = deriveEffectivePrivateData(request)
): RecommendationConsentEvaluation {
  const auditEvent = createPrivacySafeConsentEvent(request, decision, reason, effectivePrivateData);
  return Object.freeze({ ...auditEvent, auditEvent });
}

function fallbackRequest(dataUse: RecommendationDataUse): RecommendationConsentRequest {
  return {
    subjectId: "redacted",
    dataUse,
    protocol: "unknown",
    sourceVisibility: "unknown",
    accessBasis: "unknown"
  };
}

function getSafeDataUseFromInvalidRequest(request: unknown): RecommendationDataUse {
  if (request !== null && typeof request === "object") {
    const candidate = request as Partial<RecommendationConsentRequest>;
    if (isKnownDataUse(candidate.dataUse)) {
      return candidate.dataUse;
    }
  }

  return "ranking";
}

export function evaluateRecommendationConsent(
  policy: RecommendationConsentPolicy | null | undefined,
  request: RecommendationConsentRequest
): RecommendationConsentEvaluation {
  if (!isValidRequest(request)) {
    return createEvaluation(
      fallbackRequest(getSafeDataUseFromInvalidRequest(request)),
      "deny",
      "consent.deny.invalid_request",
      false
    );
  }

  const effectivePrivateData = deriveEffectivePrivateData(request);

  if (request.protocol === "unknown") {
    return createEvaluation(request, "deny", "access.deny.protocol_scope_unknown", effectivePrivateData);
  }

  if (policy === null || policy === undefined) {
    return createEvaluation(request, "deny", "consent.deny.default", effectivePrivateData);
  }

  if (!isValidPolicy(policy)) {
    return createEvaluation(request, "deny", "consent.deny.invalid_policy", effectivePrivateData);
  }

  if (policy.subjectId !== request.subjectId) {
    return createEvaluation(request, "deny", "consent.deny.subject_mismatch", effectivePrivateData);
  }

  if (isNonEmptyString(policy.revokedAt)) {
    return createEvaluation(request, "deny", "consent.deny.revoked", effectivePrivateData);
  }

  if (isNonEmptyString(policy.deleteDerivedDataRequestedAt)) {
    return createEvaluation(request, "deny", "consent.deny.deleted", effectivePrivateData);
  }

  if (!includesUse(policy.allowedDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "consent.deny.use_not_allowed", effectivePrivateData);
  }

  if (request.serverSideProcessing === true && !includesUse(policy.serverSideDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "consent.deny.server_processing_not_allowed", effectivePrivateData);
  }

  if (request.providerPolicyAllowsProcessing === false) {
    return createEvaluation(request, "deny", "policy.deny.provider_policy", effectivePrivateData);
  }

  const visibilityDecision = visibilityAllowsAccess(request.sourceVisibility, request.accessBasis);
  if (visibilityDecision !== "allow") {
    return createEvaluation(request, "deny", visibilityDecision, effectivePrivateData);
  }

  if (effectivePrivateData && !includesUse(policy.privateDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "safety.deny.private_data_use_not_allowed", effectivePrivateData);
  }

  if (
    effectivePrivateData &&
    request.containsThirdPartyData === true &&
    !includesUse(policy.thirdPartyPrivateDataUses, request.dataUse)
  ) {
    return createEvaluation(request, "deny", "safety.deny.third_party_private_data", effectivePrivateData);
  }

  return createEvaluation(request, "allow", "consent.allow.explicit", effectivePrivateData);
}

export function markRecommendationConsentForDeletion(
  policy: RecommendationConsentPolicy,
  requestedAt: string
): RecommendationConsentPolicy {
  if (!isValidPolicy(policy) || !isNonEmptyString(requestedAt)) {
    throw new TypeError("Invalid recommendation consent deletion request.");
  }

  const nextPolicy: RecommendationConsentPolicy = {
    ...policy,
    allowedDataUses: [...policy.allowedDataUses],
    deleteDerivedDataRequestedAt: requestedAt
  };

  if (policy.privateDataUses !== undefined) {
    nextPolicy.privateDataUses = [...policy.privateDataUses];
  }

  if (policy.thirdPartyPrivateDataUses !== undefined) {
    nextPolicy.thirdPartyPrivateDataUses = [...policy.thirdPartyPrivateDataUses];
  }

  if (policy.serverSideDataUses !== undefined) {
    nextPolicy.serverSideDataUses = [...policy.serverSideDataUses];
  }

  return Object.freeze(nextPolicy);
}

export function createRecommendationDerivedDataDeletionIntent(
  subjectId: string,
  requestedAt: string,
  targets: readonly RecommendationDerivedDataTarget[] = RECOMMENDATION_DERIVED_DATA_TARGETS
): RecommendationDerivedDataDeletionIntent {
  if (!isNonEmptyString(subjectId) || !isNonEmptyString(requestedAt)) {
    throw new TypeError("Invalid recommendation derived data deletion intent.");
  }

  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length === 0 || uniqueTargets.some((target) => !RECOMMENDATION_DERIVED_DATA_TARGETS.includes(target))) {
    throw new TypeError("Invalid recommendation derived data deletion targets.");
  }

  return Object.freeze({
    subjectId,
    requestedAt,
    scope: "recommendation_derived_data",
    targets: Object.freeze(uniqueTargets)
  });
}
