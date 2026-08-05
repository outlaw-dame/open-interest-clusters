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
  "signal.deny.local_boundary_mismatch"
] as const;
export type RecommendationPublicSignalPolicyReason =
  typeof RECOMMENDATION_PUBLIC_SIGNAL_POLICY_REASONS[number];

export interface RecommendationPublicSignalPolicyInput {
  action: RecommendationInterestAction;
  polarity: RecommendationInterestPolarity;
  targetKind: RecommendationInterestTargetKind;
  dataUse: RecommendationDataUse;
  privacyBoundary: RecommendationInterestPrivacyBoundary;
  evidence: RecommendationInterestEvidence;
  consent: PrivacySafeRecommendationConsentEvent;
}

export interface RecommendationPublicSignalPolicyEvaluation {
  decision: "allow" | "deny";
  reason: RecommendationPublicSignalPolicyReason;
  effect: RecommendationSignalEffectKind;
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

function evaluation(
  decision: "allow" | "deny",
  reason: RecommendationPublicSignalPolicyReason,
  effect: RecommendationSignalEffectKind
): RecommendationPublicSignalPolicyEvaluation {
  return Object.freeze({ decision, reason, effect });
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

function isLocalOwnerEvidence(input: RecommendationPublicSignalPolicyInput): boolean {
  return (
    input.evidence.protocol === "app_local" &&
    input.evidence.sourceVisibility === "local_only" &&
    input.evidence.accessBasis === "owner" &&
    input.evidence.trustBoundary === "user_owned" &&
    input.privacyBoundary === "local_only" &&
    input.consent.serverSideProcessing === false &&
    (input.dataUse === "local_personalization" || input.dataUse === "ranking")
  );
}

function isUserControlledRemoteEvidence(input: RecommendationPublicSignalPolicyInput): boolean {
  return (
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

  if (isExplicitPublic(input)) {
    return evaluation("allow", "signal.allow.explicit_public", effect);
  }
  if (isAtprotoPublicRepository(input)) {
    return evaluation("allow", "signal.allow.atproto_public_repo", effect);
  }
  if (isLocalOwnerEvidence(input)) {
    return evaluation("allow", "signal.allow.local_owner", effect);
  }
  if (isUserControlledRemoteEvidence(input)) {
    return evaluation("allow", "signal.allow.user_controlled_remote", effect);
  }

  if (input.evidence.protocol === "app_local") {
    return evaluation("deny", "signal.deny.local_boundary_mismatch", effect);
  }

  if (input.consent.containsPrivateData === true) {
    if (effect === "affinity") {
      return evaluation("deny", "signal.deny.private_affinity", effect);
    }
    if (input.privacyBoundary !== "local_only" || input.consent.serverSideProcessing) {
      return evaluation("deny", "signal.deny.remote_private_filter", effect);
    }
    return evaluation("allow", "signal.allow.local_private_filter", effect);
  }

  return evaluation("deny", "signal.deny.non_public_provider_evidence", effect);
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
