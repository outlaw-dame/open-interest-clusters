import assert from "node:assert/strict";
import test from "node:test";

import { deriveRecommendationProfilePinnedInterestEvidence } from "../src/index.js";

const PINNED_ONLY_POLICY = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: {
    protocol: "activitypub" as const,
    rawProfileText: "unsupported" as const,
    pinnedPosts: "supported" as const,
    discoverabilityControl: "unsupported" as const,
    indexabilityControl: "unsupported" as const,
    noindexSignal: "unsupported" as const,
    featuredHashtags: "unsupported" as const
  }
};

test("unsupported absent profile text is neutral when pinned posts are supported", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "activitypub",
    accountId: "https://pinned.example/users/alice",
    accountUri: "https://pinned.example/users/alice",
    profile: {},
    pinnedPosts: [{
      pinned: true,
      uri: "https://pinned.example/users/alice/posts/1",
      content: "Federated social and open standards",
      spoiler_text: ""
    }],
    keywords: ["open standards"],
    policy: PINNED_ONLY_POLICY,
    observedAt: "2026-08-09T11:00:00Z"
  });

  assert.deepEqual(evidence.map((item) => [item.kind, item.keyword]), [
    ["pinned_post_keyword", "open standards"]
  ]);
});

test("a provider cannot declare profile text unsupported while supplying profile text", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "activitypub",
      accountId: "https://pinned.example/users/alice",
      accountUri: "https://pinned.example/users/alice",
      profile: { summary: "This text must not be smuggled through an unsupported capability" },
      pinnedPosts: [],
      keywords: ["open standards"],
      policy: PINNED_ONLY_POLICY,
      observedAt: "2026-08-09T11:00:00Z"
    }),
    /not eligible/u
  );
});
