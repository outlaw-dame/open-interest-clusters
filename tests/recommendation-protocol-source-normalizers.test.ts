import test from "node:test";
import assert from "node:assert/strict";

import {
  createActivityPubRecommendationSourceItem,
  createAtprotoRecommendationSourceItem,
  createRecommendationConsentRequestFromSource,
  toCanonicalActivityPubRecommendationEvent,
  toCanonicalAtprotoRecommendationEvent,
  type RecommendationActivityPubNormalizedEvent,
  type RecommendationAtprotoNormalizedRecordEvent
} from "../src/index.js";

const activityPubNote: RecommendationActivityPubNormalizedEvent = {
  type: "Create",
  activityId: "https://social.example/users/alice/statuses/1/activity",
  actorUri: "https://social.example/users/alice",
  actorHandle: "alice@social.example",
  objectId: "https://social.example/users/alice/statuses/1",
  objectType: "Note",
  visibility: "followers_only",
  publishedAt: "2026-05-20T12:00:00.000Z",
  observedAt: "2026-05-20T12:00:02.000Z",
  plaintext: "local-first recommendations should respect consent",
  tags: ["ActivityPub", "Privacy"],
  containsThirdPartyData: true,
  serverSideProcessing: true,
  providerPolicyAllowsProcessing: true
};

const atprotoPost: RecommendationAtprotoNormalizedRecordEvent = {
  operation: "create",
  repositoryDid: "did:plc:alice123",
  collection: "app.bsky.feed.post",
  rkey: "post1",
  atUri: "at://did:plc:alice123/app.bsky.feed.post/post1",
  cid: "bafyreialice",
  handle: "alice.example.com",
  repositoryVisibility: "public_repo",
  createdAt: "2026-05-20T13:00:00.000Z",
  observedAt: "2026-05-20T13:00:02.000Z",
  plaintext: "ATProto public repo signal",
  labels: undefined
} as RecommendationAtprotoNormalizedRecordEvent;

test("ActivityPub normalizer maps private/followers visibility before consent", () => {
  const event = toCanonicalActivityPubRecommendationEvent(activityPubNote);
  assert.equal(event.kind, "PostCreate");
  assert.equal(event.sourceProtocol, "activitypub");
  assert.equal(event.visibility, "followers");
  assert.equal(event.actor?.activityPubActorUri, "https://social.example/users/alice");
  assert.equal(event.object?.activityPubObjectId, "https://social.example/users/alice/statuses/1");
  assert.equal(event.content?.kind, "note");
  assert.deepEqual(event.content?.tags, ["ActivityPub", "Privacy"]);

  const item = createActivityPubRecommendationSourceItem(activityPubNote);
  assert.notEqual(item, null);
  assert.equal(item?.kind, "post");
  assert.equal(item?.context.protocol, "activitypub");
  assert.equal(item?.context.sourceVisibility, "followers_only");
  assert.equal(item?.context.accessBasis, "follower_relationship");
  assert.equal(item?.context.containsPrivateData, true);
  assert.equal(item?.context.containsThirdPartyData, true);
  assert.equal(item?.context.serverSideProcessing, true);
  assert.equal(item?.context.providerPolicyAllowsProcessing, true);
  assert.equal(item?.provenance.adapterId, "activitypub-recommendation-normalizer");
  assert.equal(item?.provenance.sourceSystem, "activitypub.normalized.v1");
  assert.equal(item?.provenance.opaqueSourceId, "activitypub:https://social.example/users/alice/statuses/1/activity:PostCreate");
});

test("ActivityPub normalizer maps Undo Like into reaction removal", () => {
  const item = createActivityPubRecommendationSourceItem({
    ...activityPubNote,
    type: "Undo",
    undoType: "Like",
    activityId: "https://social.example/activities/undo-like-1",
    objectType: "Note",
    objectId: "https://social.example/users/bob/statuses/1",
    targetActorUri: "https://social.example/users/bob",
    targetHandle: "bob@social.example",
    visibility: "public"
  });

  assert.notEqual(item, null);
  assert.equal(item?.kind, "reaction");
  assert.equal(item?.context.sourceVisibility, "public");
  assert.equal(item?.context.containsPrivateData, false);
  assert.equal(item?.provenance.opaqueSourceId, "activitypub:https://social.example/activities/undo-like-1:ReactionRemove");
});

test("ActivityPub normalizer rejects unsafe identifiers before source item creation", () => {
  assert.throws(
    () =>
      createActivityPubRecommendationSourceItem({
        ...activityPubNote,
        actorHandle: `alice${String.fromCharCode(133)}@social.example`
      }),
    TypeError
  );

  assert.throws(
    () =>
      createActivityPubRecommendationSourceItem({
        ...activityPubNote,
        activityId: "https://user:pass@social.example/activity/1"
      }),
    TypeError
  );
});

test("ATProto normalizer maps public repo posts to public-repo source context", () => {
  const event = toCanonicalAtprotoRecommendationEvent(atprotoPost);
  assert.equal(event.kind, "PostCreate");
  assert.equal(event.sourceProtocol, "atproto");
  assert.equal(event.visibility, "public");
  assert.equal(event.actor?.did, "did:plc:alice123");
  assert.equal(event.object?.atUri, "at://did:plc:alice123/app.bsky.feed.post/post1");
  assert.equal(event.object?.cid, "bafyreialice");
  assert.equal(event.content?.kind, "note");

  const item = createAtprotoRecommendationSourceItem(atprotoPost);
  assert.notEqual(item, null);
  assert.equal(item?.kind, "post");
  assert.equal(item?.context.protocol, "atproto");
  assert.equal(item?.context.sourceVisibility, "atproto_public_repo");
  assert.equal(item?.context.accessBasis, "atproto_public_repo");
  assert.equal(item?.context.containsPrivateData, false);
  assert.equal(item?.provenance.adapterId, "atproto-recommendation-normalizer");
  assert.equal(item?.provenance.sourceSystem, "atproto.normalized.v1");
  assert.equal(item?.provenance.opaqueSourceId, "atproto:at://did:plc:alice123/app.bsky.feed.post/post1:PostCreate");
});

test("ATProto normalizer maps block records directly to block source items", () => {
  const item = createAtprotoRecommendationSourceItem({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.graph.block",
    atUri: "at://did:plc:alice123/app.bsky.graph.block/block1",
    subjectDid: "did:plc:bob456",
    repositoryVisibility: "public_repo",
    observedAt: "2026-05-20T13:01:00.000Z",
    containsThirdPartyData: true
  });

  assert.notEqual(item, null);
  assert.equal(item?.kind, "block");
  assert.equal(item?.context.protocol, "atproto");
  assert.equal(item?.context.sourceVisibility, "atproto_public_repo");
  assert.equal(item?.context.accessBasis, "atproto_public_repo");
  assert.equal(item?.context.containsPrivateData, false);
  assert.equal(item?.context.containsThirdPartyData, true);
  assert.equal(item?.provenance.opaqueSourceId, "create:at://did:plc:alice123/app.bsky.graph.block/block1");
});

test("ATProto normalizer rejects invalid operations and unsafe URIs", () => {
  assert.throws(
    () =>
      createAtprotoRecommendationSourceItem({
        ...atprotoPost,
        operation: "update",
        collection: "app.bsky.feed.like",
        atUri: "at://did:plc:alice123/app.bsky.feed.like/like1"
      }),
    TypeError
  );

  assert.throws(
    () =>
      createAtprotoRecommendationSourceItem({
        ...atprotoPost,
        atUri: "at://did:plc:alice123/app.bsky.feed.post/post1?bad=true"
      }),
    TypeError
  );
});

test("protocol normalizers do not leak actor or object identifiers into consent requests", () => {
  const item = createAtprotoRecommendationSourceItem(atprotoPost);
  assert.notEqual(item, null);

  const request = createRecommendationConsentRequestFromSource({
    subjectId: "did:web:reader.example",
    dataUse: "ranking",
    source: item!
  });
  const serialized = JSON.stringify(request);

  assert.equal(serialized.includes("did:plc:alice123"), false);
  assert.equal(serialized.includes("at://did:plc:alice123/app.bsky.feed.post/post1"), false);
  assert.equal(serialized.includes("alice.example.com"), false);
  assert.equal(request.protocol, "atproto");
  assert.equal(request.sourceVisibility, "atproto_public_repo");
});
