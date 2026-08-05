import type {
  PrivacySafeRecommendationConsentEvent,
  RecommendationDataUse
} from "./consent.js";
import type {
  RecommendationInterestAction,
  RecommendationInterestPolarity,
  RecommendationInterestPrivacyBoundary,
  RecommendationInterestTargetKind
} from "./interest-signal.js";
import type { RecommendationInterestEvidence } from "./interest-signal.js";
import {
  evaluateRecommendationStorageAuthority,
  inferLegacyRecommendationStorageAuthority,
  isRecommendationStorageAuthority,
  type RecommendationStorageAuthority
} from "./storage-authority.js";

export const RECOMMENDATION_SIGNAL_EFFECT_KINDS = ["affinity", "filtering"] as const;
export type RecommendationSignalEffectKind = typeof RECOMMENDATION_SIGNAL_EFFECT_KINDS[number];

export const RECOMMENDATION_PUBLIC_SIGNAL_POLICY_REASONS = [
  "signal.allow.explicit_public",
  "signal.allow.atproto_public_repo",
  "signal.allow.local_owner",
  "signal.allow.user_controlled_remote",
  "signal.allow.local_private_filter",
  "signal.deny.private_affinity",
  "signal.deny.remote_private_filter",
  "signal.deny.non_public_provider_evidence",
  "signal.deny.local_boundary_mismatch",
  "signal.deny.storage_authority"
] as const;
export type RecommendationPublicSignalPolicyReason =
  typeof RECOMMENDATION_PUBLIC_SIGNAL_POLICY_REASONS[number];

export interface RecommendationPublicSignalPolicyInput {
  action: RecommendationInterestAction;
  polarity: RecommendationInterestPolarity;
  targetKind: RecommendationInterestTargetKind;
  dataUse: RecommendationDataUse;
  privacyBoundary: RecommendationInterestPrivacyBoundary;
  storageAuthority?: RecommendationStorageAuthority;
  evidence: RecommendationInterestEvidence;
  consent: PrivacySafeRecommendationConsentEvent;
}

export interface RecommendationPublicSignalPolicyEvaluation {
  decision: "allow" | "deny";
  reason: RecommendationPublicSignalPolicyReason;
  effect: RecommendationSignalEffectKind;
  storageAuthority: RecommendationStorageAuthority;
}

const FILTER_ACTIONS = new Set<RecommendationInterestAction>([
  "dismiss",
  "hide",
  "block",
  "mute"
]);

function signalEffect(input: RecommendationPublicSignalPolicyInput): RecommendationSignalEffectKind {
  if (
    (FILTER_ACTIONS.has(input.action) && input.polarity === "negative") ||
    (input.targetKind === "moderation_label" && input.polarity !== "positive")
  ) {
    return "filtering";
  }
  return "affinity";
}

function resolvedStorageAuthority(
  input: RecommendationPublicSignalPolicyInput
): RecommendationStorageAuthority {
  if (input.storageAuthority !== undefined) {
    if (!isRecommendationStorageAuthority(input.storageAuthority)) {
      throw new TypeError("Invalid recommendation signal storage authority.");
    }
    return input.storageAuthority;
  }

  if (
    input.privacyBoundary === "server_allowed" &&
    input.evidence.protocol === "activitypods" &&
    input.evidence.sourceVisibility === "acl_controlled" &&
    input.evidence.accessBasis === "solid_acl_control" &&
    input.evidence.trustBoundary === "user_owned"
  ) {
    return "user_owned";
  }

  return inferLegacyRecommendationStorageAuthority(input.privacyBoundary);
}

function evaluation(
  decision: "allow" | "deny",
  reason: RecommendationPublicSignalPolicyReason,
  effect: RecommendationSignalEffectKind,
  storageAuthority: RecommendationStorageAuthority
): RecommendationPublicSignalPolicyEvaluation {
  return Object.freeze({ decision, reason, effect, storageAuthority });
}

function isExplicitPublic(input: RecommendationPublicSignalPolicyInput): boolean {
  return (
    input.consent.containsPrivateData === false &&
    input.evidence.sourceVisibility === "public" &&
    input.evidence.accessBasis === "public_web"
  );
}

function isAtprotoPublicRepository(input: RecommendationPublicSignalPolicyInput): boolean {
  return (
    input.consent.containsPrivateData === false &&
    input.evidence.protocol === "atproto" &&
    input.evidence.sourceVisibility === "atproto_public_repo" &&
    input.evidence.accessBasis === "atproto_public_repo"
  );
}

function isLocalOwnerEvidence(
  input: RecommendationPublicSignalPolicyInput,
  storageAuthority: RecommendationStorageAuthority
): boolean {
  return (
    storageAuthority === "device_owned" &&
    input.evidence.protocol === "app_local" &&
    input.evidence.sourceVisibility === "local_only" &&
    input.evidence.accessBasis === "owner" &&
    input.evidence.trustBoundary === "user_owned" &&
    input.privacyBoundary === "local_only" &&
    input.consent.serverSideProcessing === false &&
    (input.dataUse === "local_personalization" || input.dataUse === "ranking")
  );
}

function isUserControlledRemoteEvidence(
  input: RecommendationPublicSignalPolicyInput,
  storageAuthority: RecommendationStorageAuthority
): boolean {
  return (
    storageAuthority === "user_owned" &&
    input.evidence.protocol === "activitypods" &&
    input.evidence.sourceVisibility === "acl_controlled" &&
    input.evidence.accessBasis === "solid_acl_control" &&
    input.evidence.trustBoundary === "user_owned" &&
    input.privacyBoundary === "server_allowed" &&
    input.consent.containsPrivateData === true &&
    input.consent.containsThirdPartyData === false &&
    input.consent.serverSideProcessing === true &&
    (input.dataUse === "local_personalization" || input.dataUse === "ranking")
  );
}

export function evaluateRecommendationPublicSignalPolicy(
  input: RecommendationPublicSignalPolicyInput
): RecommendationPublicSignalPolicyEvaluation {
  const effect = signalEffect(input);
  const storageAuthority = resolvedStorageAuthority(input);
  const authorityEvaluation = evaluateRecommendationStorageAuthority({
    authority: storageAuthority,
    processingBoundary: input.privacyBoundary
  });

  if (authorityEvaluation.decision === "deny") {
    return evaluation("deny", "signal.deny.storage_authority", effect, storageAuthority);
  }

  if (isExplicitPublic(input)) {
    return evaluation("allow", "signal.allow.explicit_public", effect, storageAuthority);
  }
  if (isAtprotoPublicRepository(input)) {
    return evaluation("allow", "signal.allow.atproto_public_repo", effect, storageAuthority);
  }
  if (isLocalOwnerEvidence(input, storageAuthority)) {
    return evaluation("allow", "signal.allow.local_owner", effect, storageAuthority);
  }
  if (isUserControlledRemoteEvidence(input, storageAuthority)) {
    return evaluation("allow", "signal.allow.user_controlled_remote", effect, storageAuthority);
  }

  if (input.evidence.protocol === "app_local") {
    return evaluation("deny", "signal.deny.local_boundary_mismatch", effect, storageAuthority);
  }

  if (input.consent.containsPrivateData === true) {
    if (effect === "affinity") {
      return evaluation("deny", "signal.deny.private_affinity", effect, storageAuthority);
    }
    if (
      storageAuthority !== "device_owned" ||
      input.privacyBoundary !== "local_only" ||
      input.consent.serverSideProcessing
    ) {
      return evaluation("deny", "signal.deny.remote_private_filter", effect, storageAuthority);
    }
    return evaluation("allow", "signal.allow.local_private_filter", effect, storageAuthority);
  }

  return evaluation("deny", "signal.deny.non_public_provider_evidence", effect, storageAuthority);
}

export function requireRecommendationPublicSignalPolicy(
  input: RecommendationPublicSignalPolicyInput
): RecommendationPublicSignalPolicyEvaluation {
  const result = evaluateRecommendationPublicSignalPolicy(input);
  if (result.decision === "deny") {
    throw new TypeError(`Recommendation interest signal violates public-only policy: ${result.reason}.`);
  }
  return result;
}
