import test from "node:test";
import assert from "node:assert/strict";

import {
  createActivityPubRecommendationSourceItem,
  createAtprotoRecommendationSourceItem,
  mapActivityPubProviderActivityToNormalizedEvent,
  mapAtprotoProviderRecordToNormalizedEvent,
  mapMastodonProviderStatusToActivityPubNormalizedEvent
} from "../src/index.js";

test("maps Mastodon statuses into normalized ActivityPub create events", () => {
  const event = mapMastodonProviderStatusToActivityPubNormalizedEvent({
    observedAt: "2026-05-23T20:00:00.000Z",
    containsThirdPartyData: true,
    rawStatus: {
      uri: "https://social.example/users/alice/statuses/1",
      url: "https://social.example/@alice/1#fragment",
      created_at: "2026-05-23T19:59:00.000Z",
      edited_at: "2026-05-23T19:59:30.000Z",
      visibility: "public",
      content: "<p>Hello &amp; welcome</p><img alt=\">\" src=\"https://cdn.example/x.png\">after",
      language: "EN",
      tags: [{ name: "Fediverse" }, { name: "ActivityPub" }],
      account: {
        acct: "alice@social.example",
        uri: "https://social.example/users/alice",
        url: "https://social.example/@alice"
      }
    }
  });

  assert.equal(event.type, "Create");
  assert.equal(event.activityId, "https://social.example/users/alice/statuses/1");
  assert.equal(event.actorUri, "https://social.example/users/alice");
  assert.equal(event.actorHandle, "alice@social.example");
  assert.equal(event.objectId, "https://social.example/users/alice/statuses/1");
  assert.equal(event.objectType, "Note");
  assert.equal(event.visibility, "public");
  assert.equal(event.publishedAt, "2026-05-23T19:59:00.000Z");
  assert.equal(event.updatedAt, "2026-05-23T19:59:30.000Z");
  assert.equal(event.plaintext, "Hello & welcome after");
  assert.equal(event.language, "en");
  assert.deepEqual(event.tags, ["ActivityPub", "Fediverse"]);
  assert.equal(event.containsThirdPartyData, true);

  const item = createActivityPubRecommendationSourceItem(event);
  assert.equal(item?.kind, "post");
  assert.equal(item?.context.protocol, "activitypub");
});

test("maps Mastodon boosts as ActivityPub announces without copying private text", () => {
  const event = mapMastodonProviderStatusToActivityPubNormalizedEvent({
    observedAt: "2026-05-23T20:00:00.000Z",
    rawStatus: {
      uri: "https://social.example/users/bob/statuses/boost-1",
      url: "https://social.example/@bob/boost-1",
      created_at: "2026-05-23T20:00:00.000Z",
      visibility: "private",
      account: {
        acct: "bob@social.example",
        uri: "https://social.example/users/bob"
      },
      reblog: {
        uri: "https://remote.example/users/alice/statuses/99",
        url: "https://remote.example/@alice/99",
        content: "<p>remote text should not be copied into announce</p>",
        account: {
          acct: "alice@remote.example",
          uri: "https://remote.example/users/alice",
          url: "https://remote.example/@alice"
        }
      }
    }
  });

  assert.equal(event.type, "Announce");
  assert.equal(event.visibility, "followers_only");
  assert.equal(event.objectId, "https://remote.example/users/alice/statuses/99");
  assert.equal(event.targetActorUri, "https://remote.example/users/alice");
  assert.equal(event.targetHandle, "alice@remote.example");
  assert.equal(event.plaintext, undefined);
});

test("maps generic ActivityPub activities and infers visibility from recipients", () => {
  const event = mapActivityPubProviderActivityToNormalizedEvent({
    observedAt: "2026-05-23T21:00:00.000Z",
    rawActivity: {
      id: "https://pod.example/alice/outbox/1",
      type: "Create",
      actor: "https://pod.example/alice#me",
      cc: ["https://www.w3.org/ns/activitystreams#Public"],
      object: {
        id: "https://pod.example/alice/posts/1",
        type: "Article",
        published: "2026-05-23T20:59:00.000Z",
        content: "<p>Long-form pod post</p>",
        tag: [{ name: "Solid" }, { name: "ActivityPods" }]
      }
    }
  });

  assert.equal(event.type, "Create");
  assert.equal(event.actorUri, "https://pod.example/alice");
  assert.equal(event.objectId, "https://pod.example/alice/posts/1");
  assert.equal(event.objectType, "Article");
  assert.equal(event.visibility, "unlisted");
  assert.equal(event.plaintext, "Long-form pod post");
  assert.deepEqual(event.tags, ["ActivityPods", "Solid"]);
});

test("generic ActivityPub non-content activities do not copy object plaintext", () => {
  const event = mapActivityPubProviderActivityToNormalizedEvent({
    observedAt: "2026-05-23T21:10:00.000Z",
    rawActivity: {
      id: "https://pod.example/alice/outbox/2",
      type: "Announce",
      actor: { id: "https://pod.example/alice#me", url: "https://pod.example/alice" },
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      object: {
        id: "https://remote.example/posts/2",
        type: "Note",
        content: "<p>This should not be duplicated on an announce</p>"
      }
    }
  });

  assert.equal(event.type, "Announce");
  assert.equal(event.actorUri, "https://pod.example/alice");
  assert.equal(event.plaintext, undefined);
});

test("maps ATProto post records into normalized record events", () => {
  const event = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.post",
    rkey: "post1",
    cid: "bafyreialice",
    handle: "alice.example.com",
    observedAt: "2026-05-23T22:00:00.000Z",
    record: {
      text: "hello bluesky",
      langs: ["en"],
      createdAt: "2026-05-23T21:59:00.000Z"
    }
  });

  assert.equal(event.operation, "create");
  assert.equal(event.repositoryDid, "did:plc:alice123");
  assert.equal(event.collection, "app.bsky.feed.post");
  assert.equal(event.atUri, "at://did:plc:alice123/app.bsky.feed.post/post1");
  assert.equal(event.cid, "bafyreialice");
  assert.equal(event.handle, "alice.example.com");
  assert.equal(event.repositoryVisibility, "public_repo");
  assert.equal(event.plaintext, "hello bluesky");
  assert.equal(event.language, "en");

  const item = createAtprotoRecommendationSourceItem(event);
  assert.equal(item?.kind, "post");
  assert.equal(item?.context.protocol, "atproto");
});

test("ATProto graph and feed records require valid subjects", () => {
  assert.throws(
    () =>
      mapAtprotoProviderRecordToNormalizedEvent({
        operation: "create",
        repositoryDid: "did:plc:alice123",
        collection: "app.bsky.graph.follow",
        rkey: "follow1",
        observedAt: "2026-05-23T22:00:00.000Z",
        record: { subject: "not-a-did" }
      }),
    /graph subject/u
  );

  const like = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.like",
    rkey: "like1",
    observedAt: "2026-05-23T22:00:00.000Z",
    record: { subject: { uri: "at://did:plc:bob456/app.bsky.feed.post/post1", cid: "bafyreibob" } }
  });

  assert.equal(like.subjectAtUri, "at://did:plc:bob456/app.bsky.feed.post/post1");
});

test("ATProto labels are rejected as repository records", () => {
  assert.throws(
    () =>
      mapAtprotoProviderRecordToNormalizedEvent({
        operation: "create",
        repositoryDid: "did:plc:labeler123",
        collection: "com.atproto.label.defs#label" as never,
        rkey: "label1",
        observedAt: "2026-05-23T22:30:00.000Z",
        record: {
          uri: "did:plc:target456",
          val: "spam"
        }
      }),
    /collection/u
  );
});
