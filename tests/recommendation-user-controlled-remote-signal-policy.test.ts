import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecommendationPublicSignalPolicy,
  normalizeRecommendationInterestSignal,
  type RecommendationInterestSignalInput
} from "../src/index.js";

const OBSERVED_AT = "2026-08-05T19:30:00.000Z";

function activityPodSignal(
  overrides: Partial<RecommendationInterestSignalInput> = {}
): RecommendationInterestSignalInput {
  return {
    target: { kind: "canonical_interest", key: "technology" },
    action: "select",
    polarity: "positive",
    strength: 1,
    confidence: 1,
    dataUse: "local_personalization",
    privacyBoundary: "server_allowed",
    evidence: {
      sourceItemKind: "collection",
      protocol: "activitypods",
      sourceVisibility: "acl_controlled",
      accessBasis: "solid_acl_control",
      trustBoundary: "user_owned",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "local_personalization",
      protocol: "activitypods",
      sourceVisibility: "acl_controlled",
      accessBasis: "solid_acl_control",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: true
    },
    ...overrides
  };
}

test("public-only policy allows affinity persisted in a user-controlled ActivityPod", () => {
  const input = activityPodSignal();
  const evaluation = evaluateRecommendationPublicSignalPolicy({
    action: input.action,
    polarity: input.polarity ?? "neutral",
    targetKind: input.target.kind,
    dataUse: input.dataUse,
    privacyBoundary: input.privacyBoundary ?? "local_only",
    evidence: input.evidence,
    consent: input.consent
  });

  assert.deepEqual(evaluation, {
    decision: "allow",
    reason: "signal.allow.user_controlled_remote",
    effect: "affinity"
  });
  assert.doesNotThrow(() => normalizeRecommendationInterestSignal(input));
});

test("user-controlled remote exception requires Solid control authority and user-owned provenance", () => {
  assert.throws(
    () => normalizeRecommendationInterestSignal(activityPodSignal({
      evidence: {
        sourceItemKind: "collection",
        protocol: "activitypods",
        sourceVisibility: "acl_controlled",
        accessBasis: "solid_acl_read",
        trustBoundary: "user_owned",
        observedAt: OBSERVED_AT
      },
      consent: {
        decision: "allow",
        reason: "consent.allow.explicit",
        dataUse: "local_personalization",
        protocol: "activitypods",
        sourceVisibility: "acl_controlled",
        accessBasis: "solid_acl_read",
        containsPrivateData: true,
        containsThirdPartyData: false,
        serverSideProcessing: true
      }
    })),
    /signal\.deny\.private_affinity/u
  );

  assert.throws(
    () => normalizeRecommendationInterestSignal(activityPodSignal({
      evidence: {
        sourceItemKind: "collection",
        protocol: "activitypods",
        sourceVisibility: "acl_controlled",
        accessBasis: "solid_acl_control",
        trustBoundary: "same_provider",
        observedAt: OBSERVED_AT
      }
    })),
    /signal\.deny\.private_affinity/u
  );
});

test("generic application-managed server storage remains denied", () => {
  assert.throws(
    () => normalizeRecommendationInterestSignal(activityPodSignal({
      evidence: {
        sourceItemKind: "collection",
        protocol: "app_local",
        sourceVisibility: "local_only",
        accessBasis: "owner",
        trustBoundary: "user_owned",
        observedAt: OBSERVED_AT
      },
      consent: {
        decision: "allow",
        reason: "consent.allow.explicit",
        dataUse: "local_personalization",
        protocol: "app_local",
        sourceVisibility: "local_only",
        accessBasis: "owner",
        containsPrivateData: true,
        containsThirdPartyData: false,
        serverSideProcessing: true
      }
    })),
    /signal\.deny\.local_boundary_mismatch/u
  );
});
