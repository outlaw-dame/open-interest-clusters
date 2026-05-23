import test from "node:test";
import assert from "node:assert/strict";

import {
  createActivityPubRecommendationSourceAdapter,
  createAtprotoRecommendationSourceAdapter,
  createProtocolSourceAdapterReadResultFromAuthorizationEvidence,
  createProtocolSourceReadAuthorizationFromEvidence,
  normalizeRecommendationProtocolSourceAuthorizationEvidence,
  readRecommendationSourceAdapterWithConsent,
  type RecommendationActivityPubNormalizedEvent,
  type RecommendationAtprotoNormalizedRecordEvent,
  type RecommendationConsentPolicy
} from "../src/index.js";

const activityPubFollowersNote: RecommendationActivityPubNormalizedEvent = {
  type: "Create",
  activityId: "https://social.example/users/alice/statuses/1/activity",
  actorUri: "https://social.example/users/alice",
  actorHandle: "alice@social.example",
  objectId: "https://social.example/users/alice/statuses/1",
  objectType: "Note",
  visibility: "followers_only",
  observedAt: "2026-05-21T12:00:00.000Z",
  plaintext: "followers-only post"
};

const activityPodsAclNote: RecommendationActivityPubNormalizedEvent = {
  type: "Create",
  activityId: "https://pod.example/alice/outbox/1",
  actorUri: "https://pod.example/alice#me",
  objectId: "https://pod.example/alice/posts/1",
  objectType: "Note",
  visibility: "private",
  observedAt: "2026-05-21T12:05:00.000Z",
  plaintext: "ACL controlled post"
};

const atprotoPost: RecommendationAtprotoNormalizedRecordEvent = {
  operation: "create",
  repositoryDid: "did:plc:alice123",
  collection: "app.bsky.feed.post",
  rkey: "post1",
  atUri: "at://did:plc:alice123/app.bsky.feed.post/post1",
  cid: "bafyreialice",
  repositoryVisibility: "public_repo",
  observedAt: "2026-05-21T13:00:00.000Z",
  plaintext: "ATProto public repo post"
};

const localPolicy: RecommendationConsentPolicy = {
  subjectId: "reader-1",
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"],
  thirdPartyPrivateDataUses: ["ranking"]
};

const serverPolicy: RecommendationConsentPolicy = {
  ...localPolicy,
  serverSideDataUses: ["ranking"]
};

test("protocol authorization evidence maps follower relationship reads conservatively", () => {
  const evidence = normalizeRecommendationProtocolSourceAuthorizationEvidence({
    kind: "activitypub.follower_relationship",
    subjectId: "reader-1",
    checkedAt: "2026-05-21T12:00:01.000Z"
  });

  assert.deepEqual(evidence, {
    kind: "activitypub.follower_relationship",
    protocol: "activitypub",
    subjectId: "reader-1",
    checkedAt: "2026-05-21T12:00:01.000Z",
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship",
    containsPrivateData: true,
    containsThirdPartyData: true,
    serverSideProcessing: true
  });

  assert.deepEqual(createProtocolSourceReadAuthorizationFromEvidence(evidence), {
    status: "authorized",
    subjectId: "reader-1",
    checkedAt: "2026-05-21T12:00:01.000Z",
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship",
    containsPrivateData: true,
    containsThirdPartyData: true,
    serverSideProcessing: true
  });
});

test("protocol authorization evidence rejects inconsistent visibility and access basis", () => {
  assert.throws(
    () =>
      normalizeRecommendationProtocolSourceAuthorizationEvidence({
        kind: "activitypub.follower_relationship",
        subjectId: "reader-1",
        checkedAt: "2026-05-21T12:00:01.000Z",
        sourceVisibility: "public"
      }),
    /visibility is inconsistent/u
  );

  assert.throws(
    () =>
      normalizeRecommendationProtocolSourceAuthorizationEvidence({
        kind: "activitypods.solid_acl_read",
        subjectId: "reader-1",
        checkedAt: "2026-05-21T12:00:01.000Z",
        accessBasis: "public_web"
      }),
    /access basis is inconsistent/u
  );
});

test("protocol authorization evidence fails closed on malformed timestamps and control characters", () => {
  assert.throws(
    () =>
      createProtocolSourceReadAuthorizationFromEvidence({
        kind: "atproto.public_repo",
        subjectId: "reader-1",
        checkedAt: "2026-02-30T12:00:01.000Z"
      }),
    /timestamp|read request/u
  );

  assert.throws(
    () =>
      createProtocolSourceReadAuthorizationFromEvidence({
        kind: "atproto.public_repo",
        subjectId: "reader-1\u0000",
        checkedAt: "2026-05-21T12:00:01.000Z"
      }),
    /subject/u
  );
});

test("protocol evidence read result feeds ActivityPub adapter shells without raw clients", async () => {
  const adapter = createActivityPubRecommendationSourceAdapter({
    read: () =>
      createProtocolSourceAdapterReadResultFromAuthorizationEvidence({
        records: [activityPubFollowersNote],
        evidence: {
          kind: "activitypub.follower_relationship",
          subjectId: "reader-1",
          checkedAt: "2026-05-21T12:00:01.000Z",
          providerPolicyAllowsProcessing: true
        },
        cursor: "next-page"
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
  assert.equal(allowed.cursor, "next-page");
  assert.equal(allowed.items[0]?.context.sourceVisibility, "followers_only");
  assert.equal(allowed.items[0]?.context.accessBasis, "follower_relationship");
  assert.equal(allowed.items[0]?.context.containsPrivateData, true);
  assert.equal(allowed.items[0]?.context.containsThirdPartyData, true);
  assert.equal(allowed.items[0]?.context.serverSideProcessing, true);
});

test("ActivityPods Solid ACL evidence projects ACL authorization onto emitted source context", async () => {
  const authorization = createProtocolSourceReadAuthorizationFromEvidence({
    kind: "activitypods.solid_acl_read",
    subjectId: "reader-1",
    checkedAt: "2026-05-21T12:05:01.000Z"
  });

  assert.equal(authorization.sourceVisibility, "acl_controlled");
  assert.equal(authorization.accessBasis, "solid_acl_read");
  assert.equal(authorization.containsPrivateData, true);
  assert.equal(authorization.containsThirdPartyData, false);
  assert.equal(authorization.serverSideProcessing, true);

  const adapter = createActivityPubRecommendationSourceAdapter({
    normalizerOptions: { adapterId: "activitypods-provider", sourceSystem: "activitypods.acl.normalized.v1" },
    read: () =>
      createProtocolSourceAdapterReadResultFromAuthorizationEvidence({
        records: [activityPodsAclNote],
        evidence: {
          kind: "activitypods.solid_acl_read",
          subjectId: "reader-1",
          checkedAt: "2026-05-21T12:05:01.000Z"
        }
      })
  });

  const allowed = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1" },
    dataUse: "ranking",
    policy: serverPolicy
  });

  assert.equal(allowed.items.length, 1);
  assert.equal(allowed.items[0]?.context.protocol, "activitypub");
  assert.equal(allowed.items[0]?.context.sourceVisibility, "acl_controlled");
  assert.equal(allowed.items[0]?.context.accessBasis, "solid_acl_read");
  assert.equal(allowed.items[0]?.context.containsPrivateData, true);
  assert.equal(allowed.items[0]?.context.containsThirdPartyData, undefined);
  assert.equal(allowed.items[0]?.context.serverSideProcessing, true);
});

test("ATProto public repo evidence remains public and local-processing friendly by default", async () => {
  const adapter = createAtprotoRecommendationSourceAdapter({
    read: () =>
      createProtocolSourceAdapterReadResultFromAuthorizationEvidence({
        records: [atprotoPost],
        evidence: {
          kind: "atproto.public_repo",
          subjectId: "reader-1",
          checkedAt: "2026-05-21T13:00:01.000Z"
        }
      })
  });

  const allowed = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1" },
    dataUse: "ranking",
    policy: localPolicy
  });

  assert.equal(allowed.items.length, 1);
  assert.equal(allowed.items[0]?.context.protocol, "atproto");
  assert.equal(allowed.items[0]?.context.sourceVisibility, "atproto_public_repo");
  assert.equal(allowed.items[0]?.context.accessBasis, "atproto_public_repo");
  assert.equal(allowed.items[0]?.context.containsPrivateData, false);
  assert.equal(allowed.items[0]?.context.containsThirdPartyData, true);
  assert.equal(allowed.items[0]?.context.serverSideProcessing, undefined);
});

test("protocol evidence read result rejects oversized batches", () => {
  assert.throws(
    () =>
      createProtocolSourceAdapterReadResultFromAuthorizationEvidence({
        records: Array.from({ length: 1_001 }, () => atprotoPost),
        evidence: {
          kind: "atproto.public_repo",
          subjectId: "reader-1",
          checkedAt: "2026-05-21T13:00:01.000Z"
        }
      }),
    /evidence read result/u
  );
});