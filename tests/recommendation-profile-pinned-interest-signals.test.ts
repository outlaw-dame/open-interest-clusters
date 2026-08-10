import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationBlueskyProfileFeatureCapabilities,
  createRecommendationMastodonProfileFeatureCapabilities,
  deriveRecommendationProfilePinnedInterestEvidence,
  type RecommendationProfileFeatureCapabilities
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

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

test("Mastodon bio and pinned posts produce weighted matching evidence", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "activitypub",
    accountId: "42",
    accountUri: "https://social.example/@alice",
    profile: { display_name: "Alice", note: "Open source developer writing about ActivityPub." },
    pinnedPosts: [{
      pinned: true,
      uri: "https://social.example/@alice/100",
      content: "My guide to local-first software and privacy.",
      spoiler_text: ""
    }],
    keywords: ["open source", "activitypub", "local-first", "sports"],
    policy: MASTODON_ALLOW,
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => [item.kind, item.keyword, item.confidence]), [
    ["bio_keyword", "open source", 0.68],
    ["bio_keyword", "activitypub", 0.68],
    ["pinned_post_keyword", "local-first", 0.82]
  ]);
});

test("Bluesky profile and pinned strong reference work without fictitious Mastodon controls", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "atproto",
    accountId: "did:plc:alice",
    accountUri: "at://did:plc:alice/app.bsky.actor.profile/self",
    profile: {
      displayName: "Alice",
      description: "Researcher focused on climate science.",
      pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/abc", cid: "bafy-post" }
    },
    pinnedPosts: {
      uri: "at://did:plc:alice/app.bsky.feed.post/abc",
      cid: "bafy-post",
      record: { text: "A practical explainer on renewable energy policy." }
    },
    keywords: ["climate science", "renewable energy"],
    policy: BLUESKY_ALLOW,
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => item.kind), ["bio_keyword", "pinned_post_keyword"]);
});

test("Bluesky plain-text non-linkified bio hashtags remain usable interest evidence", () => {
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "atproto",
    accountId: "did:plc:topics",
    accountUri: "at://did:plc:topics/app.bsky.actor.profile/self",
    profile: { description: "Climate researcher. #Climate #ActivityPub #OpenSource" },
    keywords: ["climate", "activitypub", "open source"],
    policy: BLUESKY_ALLOW,
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => item.keyword), ["climate", "activitypub", "open source"]);
});

test("Bluesky raw bio opt-out tokens work without structured or linkified hashtags", () => {
  for (const description of [
    "Climate writer. Do not use for AI or recommendations.",
    "Climate writer #NoAI",
    "Climate writer #NoRecommendations",
    "Climate writer NoAI"
  ]) {
    assert.throws(
      () => deriveRecommendationProfilePinnedInterestEvidence({
        protocol: "atproto",
        accountId: "did:plc:optout",
        accountUri: "at://did:plc:optout/app.bsky.actor.profile/self",
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

test("Bluesky preset rejects fabricated Mastodon-only featured hashtag evidence", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:alice",
      accountUri: "at://did:plc:alice/app.bsky.actor.profile/self",
      profile: { description: "Climate researcher" },
      keywords: ["climate"],
      policy: { ...BLUESKY_ALLOW, featuredTags: ["climate"] },
      observedAt: NOW
    }),
    /not eligible/u
  );
});

test("Mastodon discoverability indexability noindex and featured-tag opt-outs are respected", () => {
  for (const policy of [
    { ...MASTODON_ALLOW, discoverable: false },
    { ...MASTODON_ALLOW, indexable: false },
    { ...MASTODON_ALLOW, noindex: true },
    { ...MASTODON_ALLOW, featuredTags: ["NoAI"] }
  ]) {
    assert.throws(
      () => deriveRecommendationProfilePinnedInterestEvidence({
        protocol: "activitypub",
        accountId: "42",
        accountUri: "https://social.example/@alice",
        profile: { note: "Open source developer" },
        keywords: ["open source"],
        policy,
        observedAt: NOW
      }),
      /not eligible/u
    );
  }
});

test("generic ActivityPub providers may explicitly lack Mastodon profile extensions", () => {
  const capabilities: RecommendationProfileFeatureCapabilities = {
    protocol: "activitypub",
    rawProfileText: "supported",
    pinnedPosts: "unsupported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "unsupported"
  };
  const evidence = deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "activitypub",
    accountId: "https://example.org/users/alice",
    accountUri: "https://example.org/users/alice",
    profile: { summary: "Open standards and federated social software" },
    keywords: ["open standards", "federated social"],
    policy: {
      accountEligible: true,
      providerAllowsRecommendation: true,
      blocked: false,
      muted: false,
      domainBlocked: false,
      capabilities
    },
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => item.keyword), ["open standards", "federated social"]);
});

test("unknown privacy-relevant capability support fails closed", () => {
  const capabilities: RecommendationProfileFeatureCapabilities = {
    protocol: "activitypub",
    rawProfileText: "supported",
    pinnedPosts: "unsupported",
    discoverabilityControl: "unknown",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "unsupported"
  };
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "activitypub",
      accountId: "https://example.org/users/alice",
      accountUri: "https://example.org/users/alice",
      profile: { summary: "Open standards" },
      keywords: ["open standards"],
      policy: {
        accountEligible: true,
        providerAllowsRecommendation: true,
        blocked: false,
        muted: false,
        domainBlocked: false,
        capabilities
      },
      observedAt: NOW
    }),
    /not eligible/u
  );
});

test("custom ATProto applications can declare features independently of Bluesky", () => {
  const capabilities: RecommendationProfileFeatureCapabilities = {
    protocol: "atproto",
    rawProfileText: "supported",
    pinnedPosts: "unsupported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "supported"
  };
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:custom",
      accountUri: "at://did:plc:custom/example.profile/self",
      profile: { description: "Open social developer" },
      normalizedProfileText: "Open social developer",
      keywords: ["open social"],
      policy: {
        accountEligible: true,
        providerAllowsRecommendation: true,
        blocked: false,
        muted: false,
        domainBlocked: false,
        capabilities,
        featuredTags: ["NoRecommendations"]
      },
      observedAt: NOW
    }),
    /not eligible/u
  );
});

test("blocked accounts cannot contribute profile evidence regardless of platform capabilities", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:blocked",
      accountUri: "at://did:plc:blocked/app.bsky.actor.profile/self",
      profile: { description: "Open source developer" },
      keywords: ["open source"],
      policy: { ...BLUESKY_ALLOW, blocked: true },
      observedAt: NOW
    }),
    /not eligible/u
  );
});

test("ATProto pinned content must match the profile strong reference", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:alice",
      accountUri: "at://did:plc:alice/app.bsky.actor.profile/self",
      profile: { description: "Open source", pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/a", cid: "cid-a" } },
      pinnedPosts: { uri: "at://did:plc:alice/app.bsky.feed.post/b", cid: "cid-b", record: { text: "Open source" } },
      keywords: ["open source"],
      policy: BLUESKY_ALLOW,
      observedAt: NOW
    }),
    /strong reference/u
  );
});