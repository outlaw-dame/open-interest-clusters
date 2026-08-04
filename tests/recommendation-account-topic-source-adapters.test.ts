import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRecommendationActivityPubActorTopicSource,
  normalizeRecommendationAtprotoAccountTopicSource,
  normalizeRecommendationMastodonAccountTopicSource
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

test("Mastodon account data normalizes into the provider-neutral capability contract", () => {
  const source = normalizeRecommendationMastodonAccountTopicSource({
    account: {
      id: "42",
      uri: "https://social.example/users/alice",
      note: "Open source and climate science",
      display_name: "Alice",
      tags: [{ name: "NoArchive" }]
    },
    featuredTags: [{ name: "OpenSource" }],
    pinnedStatuses: [{
      pinned: true,
      uri: "https://social.example/users/alice/statuses/1",
      content: "Renewable energy projects",
      created_at: "2026-08-01T10:00:00.000Z"
    }],
    observedAt: NOW
  });
  assert.equal(source.protocol, "activitypub");
  assert.equal(source.capabilities.pinnedContent, "multiple");
  assert.deepEqual(source.featuredTopics, ["opensource"]);
  assert.deepEqual(source.structuredTags, ["noarchive"]);
  assert.equal(source.pinnedContent[0]?.text, "Renewable energy projects");
});

test("generic ActivityPub actors support equivalent featured and pinned extensions", () => {
  const source = normalizeRecommendationActivityPubActorTopicSource({
    actor: {
      id: "https://pods.example/alice",
      summary: "Distributed systems",
      name: "Alice",
      tag: [{ name: "ActivityPub" }]
    },
    featuredTags: [{ name: "Solid" }],
    featuredItems: {
      orderedItems: [{
        id: "https://pods.example/alice/posts/1",
        content: "Privacy-preserving social software",
        published: "2026-08-01T09:00:00.000Z"
      }]
    },
    observedAt: NOW
  });
  assert.equal(source.provider, "activitypub_actor");
  assert.equal(source.capabilities.featuredTopics, true);
  assert.equal(source.pinnedContent.length, 1);
  assert.deepEqual(source.structuredTags, ["activitypub"]);
});

test("ATProto adapter validates pinned strong references and declares actual capabilities", () => {
  const source = normalizeRecommendationAtprotoAccountTopicSource({
    profile: {
      did: "did:plc:alice",
      description: "Open protocols and local-first software",
      displayName: "Alice",
      pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/1", cid: "bafy-one" }
    },
    pinnedPost: {
      uri: "at://did:plc:alice/app.bsky.feed.post/1",
      cid: "bafy-one",
      record: { text: "Building ActivityPub bridges", createdAt: "2026-08-01T08:00:00.000Z" }
    },
    observedAt: NOW
  });
  assert.equal(source.protocol, "atproto");
  assert.equal(source.capabilities.featuredTopics, false);
  assert.equal(source.capabilities.pinnedContent, "single");
  assert.equal(source.pinnedContent[0]?.text, "Building ActivityPub bridges");

  assert.throws(
    () => normalizeRecommendationAtprotoAccountTopicSource({
      profile: { did: "did:plc:alice", pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/1", cid: "bafy-one" } },
      pinnedPost: { uri: "at://did:plc:alice/app.bsky.feed.post/1", cid: "bafy-other", record: { text: "wrong" } },
      observedAt: NOW
    }),
    /strong reference/u
  );
});
