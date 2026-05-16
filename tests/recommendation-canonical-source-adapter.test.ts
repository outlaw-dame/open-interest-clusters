import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalRecommendationSourceAdapter,
  createCanonicalRecommendationSourceContext,
  createCanonicalRecommendationSourceItem,
  createRecommendationConsentRequestFromSource,
  readRecommendationSourceAdapter,
  type CanonicalRecommendationEvent
} from "../src/index.js";

const baseEvent: CanonicalRecommendationEvent = {
  canonicalIntentId: "canonical-1",
  kind: "PostCreate",
  sourceProtocol: "activitypub",
  sourceEventId: "https://remote.example/activities/1",
  visibility: "public",
  createdAt: "2026-05-15T00:00:00.000Z",
  observedAt: "2026-05-15T00:00:01.000Z",
  actor: {
    activityPubActorUri: "https://remote.example/users/alice",
    handle: "alice@example.test"
  },
  object: {
    activityPubObjectId: "https://remote.example/objects/1"
  }
};

test("canonical context maps ActivityPub visibility into recommendation source context", () => {
  const context = createCanonicalRecommendationSourceContext({
    ...baseEvent,
    visibility: "followers",
    containsThirdPartyData: true,
    serverSideProcessing: true
  });

  assert.equal(context.protocol, "activitypub");
  assert.equal(context.sourceVisibility, "followers_only");
  assert.equal(context.accessBasis, "follower_relationship");
  assert.equal(context.containsPrivateData, true);
  assert.equal(context.containsThirdPartyData, true);
  assert.equal(context.serverSideProcessing, true);
});

test("canonical context maps ATProto public events to public repo source context", () => {
  const context = createCanonicalRecommendationSourceContext({
    ...baseEvent,
    canonicalIntentId: "canonical-at-1",
    sourceProtocol: "atproto",
    sourceEventId: "at://did:plc:alice/app.bsky.feed.post/1",
    visibility: "public"
  });

  assert.equal(context.protocol, "atproto");
  assert.equal(context.sourceVisibility, "atproto_public_repo");
  assert.equal(context.accessBasis, "atproto_public_repo");
  assert.equal(context.containsPrivateData, false);
});

test("canonical context preserves ActivityPods Solid ACL semantics", () => {
  const context = createCanonicalRecommendationSourceContext({
    ...baseEvent,
    canonicalIntentId: "canonical-apods-1",
    sourceProtocol: "activitypods",
    sourceEventId: "https://pod.example/alice/private/post/1",
    visibility: "acl_controlled",
    activityPods: {
      resourceScope: "acl_controlled",
      solidAccessMode: "read"
    },
    providerPolicyAllowsProcessing: true
  });

  assert.equal(context.protocol, "activitypods");
  assert.equal(context.sourceVisibility, "acl_controlled");
  assert.equal(context.accessBasis, "solid_acl_read");
  assert.equal(context.containsPrivateData, true);
  assert.equal(context.providerPolicyAllowsProcessing, true);
});

test("canonical source item maps event kinds and provenance without leaking actor refs into consent requests", () => {
  const item = createCanonicalRecommendationSourceItem(
    {
      ...baseEvent,
      canonicalIntentId: "canonical-reaction-1",
      kind: "ReactionAdd",
      visibility: "unlisted"
    },
    {
      sourceSystem: "canonical.v1.test",
      defaultTrustBoundary: "remote_provider"
    }
  );

  assert.notEqual(item, null);
  assert.equal(item?.kind, "reaction");
  assert.equal(item?.context.sourceVisibility, "unlisted");
  assert.equal(item?.provenance.adapterId, "canonical-recommendation-source");
  assert.equal(item?.provenance.sourceSystem, "canonical.v1.test");
  assert.equal(item?.provenance.trustBoundary, "remote_provider");
  assert.equal(item?.provenance.opaqueSourceId, "canonical-reaction-1");

  const request = createRecommendationConsentRequestFromSource({
    subjectId: "did:web:reader.example",
    dataUse: "ranking",
    source: item!
  });
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("alice@example.test"), false);
  assert.equal(serialized.includes("https://remote.example/users/alice"), false);
  assert.equal(serialized.includes("canonical-reaction-1"), false);
});

test("canonical source item skips mirrored events by default", () => {
  const item = createCanonicalRecommendationSourceItem({
    ...baseEvent,
    canonicalIntentId: "canonical-mirror-1",
    projectionMode: "mirrored"
  });

  assert.equal(item, null);
});

test("canonical source item can include mirrored events explicitly", () => {
  const item = createCanonicalRecommendationSourceItem(
    {
      ...baseEvent,
      canonicalIntentId: "canonical-mirror-1",
      projectionMode: "mirrored"
    },
    { includeMirroredEvents: true }
  );

  assert.notEqual(item, null);
  assert.equal(item?.provenance.opaqueSourceId, "canonical-mirror-1");
});

test("canonical adapter deduplicates by canonical identity and paginates results", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [
      { ...baseEvent, canonicalIntentId: "canonical-1" },
      { ...baseEvent, canonicalIntentId: "canonical-1", sourceEventId: "duplicate-source" },
      { ...baseEvent, canonicalIntentId: "canonical-2", kind: "ProfileUpdate" },
      { ...baseEvent, canonicalIntentId: "canonical-3", projectionMode: "mirrored" }
    ],
    defaultTrustBoundary: "same_provider"
  });

  const firstPage = await readRecommendationSourceAdapter(adapter, { subjectId: "subject-1", limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0]?.provenance.opaqueSourceId, "canonical-1");
  assert.equal(firstPage.cursor, "1");

  const secondPage = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    cursor: firstPage.cursor,
    limit: 10
  });
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0]?.kind, "profile");
  assert.equal(secondPage.items[0]?.provenance.opaqueSourceId, "canonical-2");
  assert.equal(secondPage.items[0]?.provenance.trustBoundary, "same_provider");
  assert.equal(secondPage.cursor, undefined);
});

test("canonical adapter honors since using observedAt for incremental reads", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [
      { ...baseEvent, canonicalIntentId: "old", observedAt: "2026-05-15T00:00:00.000Z" },
      { ...baseEvent, canonicalIntentId: "checkpoint", observedAt: "2026-05-16T00:00:00.000Z" },
      { ...baseEvent, canonicalIntentId: "new", observedAt: "2026-05-16T00:00:01.000Z" },
      { ...baseEvent, canonicalIntentId: "new", sourceEventId: "duplicate-new", observedAt: "2026-05-16T00:00:02.000Z" }
    ]
  });

  const result = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "2026-05-16T00:00:00.000Z",
    limit: 10
  });

  assert.deepEqual(
    result.items.map((item) => item.provenance.opaqueSourceId),
    ["checkpoint", "new"]
  );
  assert.equal(result.cursor, undefined);
});

test("canonical adapter paginates after since filtering and dedupe", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [
      { ...baseEvent, canonicalIntentId: "old", observedAt: "2026-05-15T00:00:00.000Z" },
      { ...baseEvent, canonicalIntentId: "one", observedAt: "2026-05-16T00:00:01.000Z" },
      { ...baseEvent, canonicalIntentId: "one", sourceEventId: "duplicate-one", observedAt: "2026-05-16T00:00:02.000Z" },
      { ...baseEvent, canonicalIntentId: "two", observedAt: "2026-05-16T00:00:03.000Z" },
      { ...baseEvent, canonicalIntentId: "three", observedAt: "2026-05-16T00:00:04.000Z" }
    ]
  });

  const firstPage = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "2026-05-16T00:00:00.000Z",
    limit: 2
  });
  assert.deepEqual(
    firstPage.items.map((item) => item.provenance.opaqueSourceId),
    ["one", "two"]
  );
  assert.equal(firstPage.cursor, "2");

  const secondPage = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "2026-05-16T00:00:00.000Z",
    cursor: firstPage.cursor,
    limit: 2
  });
  assert.deepEqual(
    secondPage.items.map((item) => item.provenance.opaqueSourceId),
    ["three"]
  );
  assert.equal(secondPage.cursor, undefined);
});

test("canonical adapter accepts strict RFC3339 timestamps with explicit offsets", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [
      {
        ...baseEvent,
        canonicalIntentId: "offset-event",
        createdAt: "2026-05-16T01:00:00+01:00",
        observedAt: "2026-05-16T01:00:00+01:00"
      }
    ]
  });

  const result = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "2026-05-15T20:00:00-04:00"
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.provenance.opaqueSourceId, "offset-event");
});

test("canonical adapter rejects malformed events, cursors, and loose timestamps", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [{ ...baseEvent, canonicalIntentId: "canonical-1" }]
  });

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "subject-1", cursor: "not-a-number" }),
    TypeError
  );
  for (const since of ["not-a-date", "0", "2026-02-30T00:00:00.000Z", "2026-05-16", "2026-05-16T00:00:00"]) {
    await assert.rejects(
      () => readRecommendationSourceAdapter(adapter, { subjectId: "subject-1", since }),
      TypeError
    );
  }
  for (const observedAt of ["not-a-date", "0", "2026-02-30T00:00:00.000Z", "2026-05-16T00:00:00"]) {
    assert.throws(
      () =>
        createCanonicalRecommendationSourceItem({
          ...baseEvent,
          canonicalIntentId: `canonical-bad-time-${observedAt}`,
          observedAt
        }),
      TypeError
    );
  }
});
