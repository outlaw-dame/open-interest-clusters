import assert from "node:assert/strict";
import test from "node:test";

import { deriveRecommendationProfilePinnedInterestEvidence } from "../src/index.js";

const CUSTOM_ATPROTO_POLICY = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: {
    protocol: "atproto" as const,
    rawProfileText: "supported" as const,
    pinnedPosts: "unsupported" as const,
    discoverabilityControl: "unsupported" as const,
    indexabilityControl: "unsupported" as const,
    noindexSignal: "unsupported" as const,
    featuredHashtags: "unsupported" as const
  }
};

const ACTIVITYPUB_POLICY = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: {
    protocol: "activitypub" as const,
    rawProfileText: "supported" as const,
    pinnedPosts: "unsupported" as const,
    discoverabilityControl: "unsupported" as const,
    indexabilityControl: "unsupported" as const,
    noindexSignal: "unsupported" as const,
    featuredHashtags: "unsupported" as const
  }
};

const BASE = {
  protocol: "atproto" as const,
  accountId: "did:plc:custom-app",
  accountUri: "at://did:plc:custom-app/com.example.actor.profile/self",
  profile: { about: "provider-native text is intentionally application-specific" },
  keywords: ["open social"],
  policy: CUSTOM_ATPROTO_POLICY,
  observedAt: "2026-08-09T17:30:00Z"
};

test("custom ATProto applications consume adapter-normalized profile text instead of Bluesky fields", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    ...BASE,
    normalizedProfileText: "Open social developer building federated systems"
  });

  assert.deepEqual(evidence.map((item) => [item.kind, item.keyword]), [
    ["bio_keyword", "open social"]
  ]);
});

test("custom ATProto adapter-normalized profile text preserves opt-outs", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      ...BASE,
      normalizedProfileText: "Open social developer. Do not use for recommendations."
    }),
    /not eligible/u
  );
});

test("custom ATProto profile parsing fails closed without adapter-normalized text", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence(BASE),
    /adapter-normalized/u
  );
});

test("an explicit empty normalized profile is a valid inspected custom ATProto surface", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    ...BASE,
    normalizedProfileText: ""
  });
  assert.deepEqual(evidence, []);
});

test("custom ATProto applications that declare profile text unsupported stay neutral", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    ...BASE,
    policy: {
      ...CUSTOM_ATPROTO_POLICY,
      capabilities: {
        ...CUSTOM_ATPROTO_POLICY.capabilities,
        rawProfileText: "unsupported" as const
      }
    }
  });
  assert.deepEqual(evidence, []);
});

test("adapter-normalized text cannot mask an ActivityPub native profile opt-out", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "activitypub",
      accountId: "https://social.example/users/alice",
      accountUri: "https://social.example/users/alice",
      profile: { note: "#NoAI Open social developer" },
      normalizedProfileText: "Open social developer",
      keywords: ["open social"],
      policy: ACTIVITYPUB_POLICY,
      observedAt: "2026-08-09T17:30:00Z"
    }),
    /not eligible/u
  );
});

test("adapter-normalized text cannot mask a native Bluesky profile opt-out", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:bluesky-user",
      accountUri: "at://did:plc:bluesky-user/app.bsky.actor.profile/self",
      profile: { description: "#NoAI Open social developer" },
      normalizedProfileText: "Open social developer",
      keywords: ["open social"],
      policy: CUSTOM_ATPROTO_POLICY,
      observedAt: "2026-08-09T17:30:00Z"
    }),
    /not eligible/u
  );
});
