import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationBlueskyProfileFeatureCapabilities,
  createRecommendationMastodonProfileFeatureCapabilities,
  deriveRecommendationProfilePinnedInterestEvidence
} from "../src/index.js";

const NOW = "2026-08-09T14:20:00.000Z";

const MASTODON_ALLOW = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: createRecommendationMastodonProfileFeatureCapabilities(),
  discoverable: true,
  indexable: true,
  noindex: false,
  featuredTags: []
} as const;

const BLUESKY_ALLOW = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: createRecommendationBlueskyProfileFeatureCapabilities()
} as const;

test("structured Mastodon profile tags preserve opt-outs without becoming affinity", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "activitypub",
      accountId: "42",
      accountUri: "https://social.example/@alice",
      profile: { note: "Open source developer" },
      keywords: ["open source"],
      policy: { ...MASTODON_ALLOW, profileTags: ["NoAI"] },
      observedAt: NOW
    }),
    /not eligible/u
  );

  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "activitypub",
    accountId: "42",
    accountUri: "https://social.example/@alice",
    profile: { note: "Open source developer" },
    keywords: ["open source", "climate"],
    policy: { ...MASTODON_ALLOW, profileTags: ["Climate"] },
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => item.keyword), ["open source"]);
});

test("unicode hashtag separators cannot bypass raw profile opt-outs", () => {
  for (const description of [
    "Climate writer #No‐AI",
    "Climate writer #No‑AI",
    "Climate writer #No–AI"
  ]) {
    assert.throws(
      () => deriveRecommendationProfilePinnedInterestEvidence({
        protocol: "atproto",
        accountId: "did:plc:unicode-optout",
        accountUri: "at://did:plc:unicode-optout/app.bsky.actor.profile/self",
        profile: { description },
        keywords: ["climate"],
        policy: BLUESKY_ALLOW,
        observedAt: NOW
      }),
      /not eligible/u,
      description
    );
  }
});
