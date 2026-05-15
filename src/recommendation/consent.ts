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

function hasInvalidAllowedUse(uses: readonly RecommendationDataUse[] | undefined): boolean {
  return uses !== undefined && (!Array.isArray(uses) || uses.some((use) => !isKnownDataUse(use)));
}

function isValidPolicy(policy: RecommendationConsentPolicy): boolean {
  return (
    isNonEmptyString(policy.subjectId) &&
    Array.isArray(policy.allowedDataUses) &&
    policy.allowedDataUses.every(isKnownDataUse) &&
    !hasInvalidAllowedUse(policy.privateDataUses) &&
    !hasInvalidAllowedUse(policy.thirdPartyPrivateDataUses) &&
    !hasInvalidAllowedUse(policy.serverSideDataUses)
  );
}

function isValidRequest(request: RecommendationConsentRequest): boolean {
  return (
    isNonEmptyString(request.subjectId) &&
    isKnownDataUse(request.dataUse) &&
    isKnownProtocol(request.protocol) &&
    isKnownVisibility(request.sourceVisibility) &&
    isKnownAccessBasis(request.accessBasis)
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
      return accessBasis === "public_web" ||
        accessBasis === "authenticated_api" ||
        accessBasis === "owner" ||
        accessBasis === "oauth_scope" ||
        accessBasis === "provider_policy"
        ? "allow"
        : "access.deny.visibility_scope";
    case "unlisted":
      return accessBasis === "authenticated_api" ||
        accessBasis === "owner" ||
        accessBasis === "oauth_scope" ||
        accessBasis === "provider_policy"
        ? "allow"
        : "access.deny.visibility_scope";
    case "followers_only":
      return accessBasis === "follower_relationship" || accessBasis === "owner"
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
    case "atproto_public_repo":
      return accessBasis === "atproto_public_repo" ||
        accessBasis === "authenticated_api" ||
        accessBasis === "oauth_scope" ||
        accessBasis === "public_web"
        ? "allow"
        : "access.deny.visibility_scope";
  }
}

function createPrivacySafeConsentEvent(
  request: RecommendationConsentRequest,
  decision: RecommendationConsentDecision,
  reason: RecommendationConsentReasonCode
): PrivacySafeRecommendationConsentEvent {
  return Object.freeze({
    decision,
    reason,
    dataUse: request.dataUse,
    protocol: request.protocol,
    sourceVisibility: request.sourceVisibility,
    accessBasis: request.accessBasis,
    containsPrivateData: request.containsPrivateData === true,
    containsThirdPartyData: request.containsThirdPartyData === true,
    serverSideProcessing: request.serverSideProcessing === true
  });
}

function createEvaluation(
  request: RecommendationConsentRequest,
  decision: RecommendationConsentDecision,
  reason: RecommendationConsentReasonCode
): RecommendationConsentEvaluation {
  const auditEvent = createPrivacySafeConsentEvent(request, decision, reason);
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

export function evaluateRecommendationConsent(
  policy: RecommendationConsentPolicy | null | undefined,
  request: RecommendationConsentRequest
): RecommendationConsentEvaluation {
  if (!isValidRequest(request)) {
    const safeDataUse = isKnownDataUse(request.dataUse) ? request.dataUse : "ranking";
    return createEvaluation(fallbackRequest(safeDataUse), "deny", "consent.deny.invalid_request");
  }

  if (request.protocol === "unknown") {
    return createEvaluation(request, "deny", "access.deny.protocol_scope_unknown");
  }

  if (policy === null || policy === undefined) {
    return createEvaluation(request, "deny", "consent.deny.default");
  }

  if (!isValidPolicy(policy)) {
    return createEvaluation(request, "deny", "consent.deny.invalid_policy");
  }

  if (policy.subjectId !== request.subjectId) {
    return createEvaluation(request, "deny", "consent.deny.subject_mismatch");
  }

  if (isNonEmptyString(policy.revokedAt)) {
    return createEvaluation(request, "deny", "consent.deny.revoked");
  }

  if (isNonEmptyString(policy.deleteDerivedDataRequestedAt)) {
    return createEvaluation(request, "deny", "consent.deny.deleted");
  }

  if (!includesUse(policy.allowedDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "consent.deny.use_not_allowed");
  }

  if (request.serverSideProcessing === true && !includesUse(policy.serverSideDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "consent.deny.server_processing_not_allowed");
  }

  if (request.providerPolicyAllowsProcessing === false) {
    return createEvaluation(request, "deny", "policy.deny.provider_policy");
  }

  const visibilityDecision = visibilityAllowsAccess(request.sourceVisibility, request.accessBasis);
  if (visibilityDecision !== "allow") {
    return createEvaluation(request, "deny", visibilityDecision);
  }

  const containsPrivateData = request.containsPrivateData === true || isPrivateVisibility(request.sourceVisibility);

  if (containsPrivateData && !includesUse(policy.privateDataUses, request.dataUse)) {
    return createEvaluation(request, "deny", "safety.deny.private_data_use_not_allowed");
  }

  if (
    containsPrivateData &&
    request.containsThirdPartyData === true &&
    !includesUse(policy.thirdPartyPrivateDataUses, request.dataUse)
  ) {
    return createEvaluation(request, "deny", "safety.deny.third_party_private_data");
  }

  return createEvaluation(request, "allow", "consent.allow.explicit");
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
