import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecommendationPublicSignalPolicy,
  normalizeRecommendationInterestSignal,
  type RecommendationInterestSignalInput
} from "../src/index.js";

const OBSERVED_AT = "2026-08-05T18:00:00.000Z";

function signalInput(overrides: Partial<RecommendationInterestSignalInput> = {}): RecommendationInterestSignalInput {
  return {
    target: { kind: "canonical_interest", key: "technology" },
    action: "view",
    polarity: "positive",
    strength: 0.7,
    confidence: 0.8,
    dataUse: "ranking",
    privacyBoundary: "local_only",
    evidence: {
      sourceItemKind: "post",
      protocol: "activitypub",
      sourceVisibility: "public",
      accessBasis: "public_web",
      trustBoundary: "remote_provider",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "ranking",
      protocol: "activitypub",
      sourceVisibility: "public",
      accessBasis: "public_web",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false
    },
    ...overrides
  };
}

test("public-only policy allows explicitly public provider evidence", () => {
  const signal = normalizeRecommendationInterestSignal(signalInput());
  assert.equal(signal.target.key, "technology");
});

test("public-only policy allows ATProto public repository evidence", () => {
  const input = signalInput({
    evidence: {
      sourceItemKind: "post",
      protocol: "atproto",
      sourceVisibility: "atproto_public_repo",
      accessBasis: "atproto_public_repo",
      trustBoundary: "remote_provider",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "ranking",
      protocol: "atproto",
      sourceVisibility: "atproto_public_repo",
      accessBasis: "atproto_public_repo",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: true
    }
  });
  assert.doesNotThrow(() => normalizeRecommendationInterestSignal(input));
});

test("public-only policy allows explicit local owner personalization", () => {
  const input = signalInput({
    dataUse: "local_personalization",
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
      serverSideProcessing: false
    }
  });
  assert.doesNotThrow(() => normalizeRecommendationInterestSignal(input));
});

test("public-only policy rejects private affinity even with generic consent", () => {
  const input = signalInput({
    evidence: {
      sourceItemKind: "post",
      protocol: "activitypub",
      sourceVisibility: "followers_only",
      accessBasis: "follower_relationship",
      trustBoundary: "remote_provider",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "ranking",
      protocol: "activitypub",
      sourceVisibility: "followers_only",
      accessBasis: "follower_relationship",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: false
    }
  });
  assert.throws(
    () => normalizeRecommendationInterestSignal(input),
    /signal\.deny\.private_affinity/u
  );
});

test("public-only policy rejects non-public provider evidence without a private flag", () => {
  const input = signalInput({
    evidence: {
      sourceItemKind: "post",
      protocol: "activitypub",
      sourceVisibility: "unlisted",
      accessBasis: "public_web",
      trustBoundary: "remote_provider",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "ranking",
      protocol: "activitypub",
      sourceVisibility: "unlisted",
      accessBasis: "public_web",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false
    }
  });
  assert.throws(
    () => normalizeRecommendationInterestSignal(input),
    /signal\.deny\.non_public_provider_evidence/u
  );
});

test("private moderation evidence is filtering-only and device-owned", () => {
  const input = signalInput({
    target: { kind: "creator", key: "blocked-creator" },
    action: "block",
    polarity: "negative",
    evidence: {
      sourceItemKind: "block",
      protocol: "activitypub",
      sourceVisibility: "acl_controlled",
      accessBasis: "owner",
      trustBoundary: "user_owned",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "ranking",
      protocol: "activitypub",
      sourceVisibility: "acl_controlled",
      accessBasis: "owner",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: false
    }
  });

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
    reason: "signal.allow.local_private_filter",
    effect: "filtering",
    storageAuthority: "device_owned"
  });
  assert.doesNotThrow(() => normalizeRecommendationInterestSignal(input));

  assert.throws(() => normalizeRecommendationInterestSignal({
    ...input,
    privacyBoundary: "server_allowed",
    consent: { ...input.consent, serverSideProcessing: true }
  }), /signal\.deny\.remote_private_filter/u);
});
