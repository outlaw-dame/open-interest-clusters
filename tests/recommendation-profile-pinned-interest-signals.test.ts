import assert from "node:assert/strict";
import test from "node:test";
import { deriveRecommendationProfilePinnedInterestEvidence } from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";
const ALLOW = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  discoverable: true,
  indexable: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  profileTags: [],
  featuredTags: []
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
    policy: ALLOW,
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => [item.kind, item.keyword, item.confidence]), [
    ["bio_keyword", "open source", 0.68],
    ["bio_keyword", "activitypub", 0.68],
    ["pinned_post_keyword", "local-first", 0.82]
  ]);
});

test("Bluesky profile and pinned strong reference are supported", () => {
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
    policy: ALLOW,
    observedAt: NOW
  });
  assert.deepEqual(evidence.map((item) => item.kind), ["bio_keyword", "pinned_post_keyword"]);
});

test("plain-text and tag opt-outs fail closed before emitting signals", () => {
  for (const profile of [
    { description: "Climate writer. Do not use for AI or recommendations." },
    { description: "Climate writer." }
  ]) {
    assert.throws(
      () => deriveRecommendationProfilePinnedInterestEvidence({
        protocol: "atproto",
        accountId: "did:plc:optout",
        accountUri: "at://did:plc:optout/app.bsky.actor.profile/self",
        profile,
        keywords: ["climate"],
        policy: profile.description.includes("Do not") ? ALLOW : { ...ALLOW, profileTags: ["NoAI"] },
        observedAt: NOW
      }),
      /not eligible/u
    );
  }
});

test("blocked and undiscoverable accounts cannot contribute profile evidence", () => {
  for (const policy of [{ ...ALLOW, blocked: true }, { ...ALLOW, discoverable: false }]) {
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

test("ATProto pinned content must match the profile strong reference", () => {
  assert.throws(
    () => deriveRecommendationProfilePinnedInterestEvidence({
      protocol: "atproto",
      accountId: "did:plc:alice",
      accountUri: "at://did:plc:alice/app.bsky.actor.profile/self",
      profile: { description: "Open source", pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/a", cid: "cid-a" } },
      pinnedPosts: { uri: "at://did:plc:alice/app.bsky.feed.post/b", cid: "cid-b", record: { text: "Open source" } },
      keywords: ["open source"],
      policy: ALLOW,
      observedAt: NOW
    }),
    /strong reference/u
  );
});
