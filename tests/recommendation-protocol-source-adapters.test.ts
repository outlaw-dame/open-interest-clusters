import test from "node:test";
import assert from "node:assert/strict";

import {
  createActivityPubRecommendationSourceAdapter,
  createAtprotoRecommendationSourceAdapter,
  readRecommendationSourceAdapter,
  readRecommendationSourceAdapterWithConsent,
  type RecommendationActivityPubNormalizedEvent,
  type RecommendationAtprotoNormalizedRecordEvent,
  type RecommendationConsentPolicy,
  type RecommendationSourceAdapterReadRequest
} from "../src/index.js";

const activityPubPrivateNote: RecommendationActivityPubNormalizedEvent = {
  type: "Create",
  activityId: "https://social.example/users/alice/statuses/1/activity",
  actorUri: "https://social.example/users/alice",
  actorHandle: "alice@social.example",
  objectId: "https://social.example/users/alice/statuses/1",
  objectType: "Note",
  visibility: "followers_only",
  publishedAt: "2026-05-20T12:00:00.000Z",
  observedAt: "2026-05-20T12:00:02.000Z",
  plaintext: "private ActivityPub recommendation signal",
  containsThirdPartyData: true,
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
  plaintext: "ATProto public repo signal"
};

const atprotoMirroredBlock: RecommendationAtprotoNormalizedRecordEvent = {
  operation: "create",
  repositoryDid: "did:plc:alice123",
  collection: "app.bsky.graph.block",
  atUri: "at://did:plc:alice123/app.bsky.graph.block/block1",
  subjectDid: "did:plc:bob456",
  repositoryVisibility: "public_repo",
  observedAt: "2026-05-20T13:01:00.000Z",
  projectionMode: "mirrored",
  containsThirdPartyData: true
};

const localPolicy: RecommendationConsentPolicy = {
  subjectId: "reader-1",
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"],
  thirdPartyPrivateDataUses: ["ranking"]
};

const serverPolicy: RecommendationConsentPolicy = {
  subjectId: "reader-1",
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"],
  thirdPartyPrivateDataUses: ["ranking"],
  serverSideDataUses: ["ranking"]
};

test("ActivityPub source adapter shells require provider authorization before normalization", async () => {
  const adapter = createActivityPubRecommendationSourceAdapter({
    id: "test-activitypub-provider",
    sourceSystem: "mastodon.authorized.normalized.v1",
    read: () => ({
      records: [activityPubPrivateNote],
      authorization: {
        status: "authorized",
        subjectId: "reader-1",
        checkedAt: "2026-05-20T12:00:03.000Z",
        sourceVisibility: "followers_only",
        accessBasis: "follower_relationship",
        containsPrivateData: true,
        containsThirdPartyData: true,
        providerPolicyAllowsProcessing: true
      },
      cursor: "next-page"
    })
  });

  const result = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1", since: "2026-05-20T12:00:00.000Z" },
    dataUse: "ranking",
    policy: localPolicy
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, "next-page");
  assert.equal(result.items[0]?.kind, "post");
  assert.equal(result.items[0]?.context.protocol, "activitypub");
  assert.equal(result.items[0]?.context.sourceVisibility, "followers_only");
  assert.equal(result.items[0]?.context.accessBasis, "follower_relationship");
  assert.equal(result.items[0]?.context.containsPrivateData, true);
  assert.equal(result.items[0]?.context.containsThirdPartyData, true);
  assert.equal(result.items[0]?.provenance.adapterId, "test-activitypub-provider");
  assert.equal(result.items[0]?.provenance.sourceSystem, "mastodon.authorized.normalized.v1");
  assert.equal(result.consentEvaluations[0]?.decision, "allow");
});

test("ActivityPub source adapter rejects subject-mismatched authorization", async () => {
  const adapter = createActivityPubRecommendationSourceAdapter({
    read: () => ({
      records: [activityPubPrivateNote],
      authorization: {
        status: "authorized",
        subjectId: "another-reader",
        checkedAt: "2026-05-20T12:00:03.000Z",
        sourceVisibility: "followers_only",
        accessBasis: "follower_relationship"
      }
    })
  });

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" }),
    /subject mismatch/u
  );
});

test("ActivityPub source adapter fails closed when private authorization capability is missing", async () => {
  const adapter = createActivityPubRecommendationSourceAdapter({
    capabilities: ["read_public"],
    read: () => ({
      records: [activityPubPrivateNote],
      authorization: {
        status: "authorized",
        subjectId: "reader-1",
        checkedAt: "2026-05-20T12:00:03.000Z",
        sourceVisibility: "followers_only",
        accessBasis: "follower_relationship",
        containsPrivateData: true
      }
    })
  });

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" }),
    /private-read/u
  );
});

test("ActivityPub source adapter preserves provider server-side processing flags for consent", async () => {
  const adapter = createActivityPubRecommendationSourceAdapter({
    read: () => ({
      records: [activityPubPrivateNote],
      authorization: {
        status: "authorized",
        subjectId: "reader-1",
        checkedAt: "2026-05-20T12:00:03.000Z",
        sourceVisibility: "followers_only",
        accessBasis: "follower_relationship",
        containsPrivateData: true,
        containsThirdPartyData: true,
        serverSideProcessing: true,
        providerPolicyAllowsProcessing: true
      }
    })
  });

  await assert.rejects(
    () =>
      readRecommendationSourceAdapterWithConsent({
        adapter,
        readRequest: { subjectId: "reader-1" },
        dataUse: "ranking",
        policy: localPolicy
      }),
    /consent.deny.server_processing_not_allowed/u
  );

  const allowed = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1" },
    dataUse: "ranking",
    policy: serverPolicy
  });

  assert.equal(allowed.items.length, 1);
  assert.equal(allowed.items[0]?.context.serverSideProcessing, true);
  assert.equal(allowed.consentEvaluations[0]?.decision, "allow");
});

test("ATProto source adapter shells read public repo records and filter mirrored direct records by default", async () => {
  const seenRequests: RecommendationSourceAdapterReadRequest[] = [];
  const adapter = createAtprotoRecommendationSourceAdapter({
    id: "test-atproto-provider",
    sourceSystem: "bluesky.repo.normalized.v1",
    read: (request) => {
      seenRequests.push(request);
      return {
        records: [atprotoPost, atprotoMirroredBlock],
        authorization: {
          status: "authorized",
          subjectId: request.subjectId,
          checkedAt: "2026-05-20T13:00:03.000Z",
          sourceVisibility: "atproto_public_repo",
          accessBasis: "atproto_public_repo"
        }
      };
    }
  });

  const result = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1", limit: 50 },
    dataUse: "ranking",
    policy: localPolicy
  });

  assert.equal(seenRequests.length, 1);
  assert.deepEqual(seenRequests[0], { subjectId: "reader-1", limit: 50 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "post");
  assert.equal(result.items[0]?.context.protocol, "atproto");
  assert.equal(result.items[0]?.context.sourceVisibility, "atproto_public_repo");
  assert.equal(result.items[0]?.provenance.adapterId, "test-atproto-provider");
  assert.equal(result.items[0]?.provenance.sourceSystem, "bluesky.repo.normalized.v1");
  assert.equal(result.deniedItemCount, 0);
});

test("ATProto source adapter can include mirrored direct block records explicitly", async () => {
  const adapter = createAtprotoRecommendationSourceAdapter({
    normalizerOptions: { includeMirroredEvents: true },
    read: (request) => ({
      records: [atprotoMirroredBlock],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-20T13:00:03.000Z",
        sourceVisibility: "atproto_public_repo",
        accessBasis: "atproto_public_repo",
        containsThirdPartyData: true
      }
    })
  });

  const result = await readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "block");
  assert.equal(result.items[0]?.context.containsThirdPartyData, true);
});

test("protocol source adapter shells reject oversized provider batches", async () => {
  const adapter = createAtprotoRecommendationSourceAdapter({
    maxRecordsPerRead: 1,
    read: (request) => ({
      records: [atprotoPost, { ...atprotoPost, rkey: "post2", atUri: "at://did:plc:alice123/app.bsky.feed.post/post2" }],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-20T13:00:03.000Z",
        sourceVisibility: "atproto_public_repo",
        accessBasis: "atproto_public_repo"
      }
    })
  });

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" }),
    /read result/u
  );
});
