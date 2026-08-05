export const RECOMMENDATION_STORAGE_AUTHORITIES = [
  "device_owned",
  "user_owned",
  "provider_owned",
  "shared_operator"
] as const;

export type RecommendationStorageAuthority =
  typeof RECOMMENDATION_STORAGE_AUTHORITIES[number];

export const RECOMMENDATION_STORAGE_AUTHORITY_REASONS = [
  "storage.allow.device_owned",
  "storage.allow.user_owned",
  "storage.deny.provider_owned",
  "storage.deny.shared_operator",
  "storage.deny.authority_boundary_mismatch"
] as const;

export type RecommendationStorageAuthorityReason =
  typeof RECOMMENDATION_STORAGE_AUTHORITY_REASONS[number];

export interface RecommendationStorageAuthorityEvaluationInput {
  authority: RecommendationStorageAuthority;
  processingBoundary: "local_only" | "server_allowed" | "aggregate_only";
}

export interface RecommendationStorageAuthorityEvaluation {
  decision: "allow" | "deny";
  reason: RecommendationStorageAuthorityReason;
}

const AUTHORITY_SET = new Set<string>(RECOMMENDATION_STORAGE_AUTHORITIES);

export function isRecommendationStorageAuthority(
  value: unknown
): value is RecommendationStorageAuthority {
  return typeof value === "string" && AUTHORITY_SET.has(value);
}

export function inferLegacyRecommendationStorageAuthority(
  processingBoundary: RecommendationStorageAuthorityEvaluationInput["processingBoundary"]
): RecommendationStorageAuthority {
  if (processingBoundary === "local_only") return "device_owned";
  if (processingBoundary === "aggregate_only") return "shared_operator";
  return "provider_owned";
}

export function evaluateRecommendationStorageAuthority(
  input: RecommendationStorageAuthorityEvaluationInput
): RecommendationStorageAuthorityEvaluation {
  if (!isRecommendationStorageAuthority(input.authority)) {
    throw new TypeError("Invalid recommendation storage authority.");
  }

  if (input.processingBoundary === "local_only") {
    return input.authority === "device_owned"
      ? Object.freeze({ decision: "allow", reason: "storage.allow.device_owned" })
      : Object.freeze({ decision: "deny", reason: "storage.deny.authority_boundary_mismatch" });
  }

  if (input.processingBoundary === "server_allowed") {
    if (input.authority === "user_owned") {
      return Object.freeze({ decision: "allow", reason: "storage.allow.user_owned" });
    }
    if (input.authority === "provider_owned") {
      return Object.freeze({ decision: "deny", reason: "storage.deny.provider_owned" });
    }
    if (input.authority === "shared_operator") {
      return Object.freeze({ decision: "deny", reason: "storage.deny.shared_operator" });
    }
    return Object.freeze({ decision: "deny", reason: "storage.deny.authority_boundary_mismatch" });
  }

  return input.authority === "shared_operator"
    ? Object.freeze({ decision: "allow", reason: "storage.deny.shared_operator" })
    : Object.freeze({ decision: "deny", reason: "storage.deny.authority_boundary_mismatch" });
}
