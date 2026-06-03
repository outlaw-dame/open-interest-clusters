import test from "node:test";
import assert from "node:assert/strict";

import {
  isRecommendationAtprotoLabelExpired,
  mergeRecommendationAtprotoLabelState,
  normalizeRecommendationAtprotoLabel
} from "../src/recommendation/atproto-labels.js";

const BASE_LABEL = Object.freeze({
  src: "did:plc:labeler123",
  uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
  cid: "bafyreibasecid123",
  val: "spam",
  cts: "2026-01-01T00:00:00Z",
  provenance: "query_labels" as const
});

test("normalizeRecommendationAtprotoLabel preserves label provenance and optional metadata", () => {
  const label = normalizeRecommendationAtprotoLabel({
    ...BASE_LABEL,
    exp: "2026-02-01T00:00:00Z",
    sig: "sig:abc123",
    ver: 1
  });

  assert.deepEqual(label, {
    labelerDid: "did:plc:labeler123",
    targetUri: "at://did:plc:alice/app.bsky.feed.post/abc123",
    targetCid: "bafyreibasecid123",
    value: "spam",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-02-01T00:00:00Z",
    signature: "sig:abc123",
    version: 1,
    provenance: "query_labels",
    negated: false
  });
});

test("normalizeRecommendationAtprotoLabel rejects labels with unsafe control characters", () => {
  assert.throws(
    () => normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, val: "spam\u0000" }),
    /Invalid ATProto label value/u
  );
});

test("normalizeRecommendationAtprotoLabel rejects malformed provenance and timestamps", () => {
  assert.throws(
    () => normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, provenance: "repo_record" as never }),
    /Invalid ATProto label provenance/u
  );

  assert.throws(
    () => normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, cts: "not-a-date" }),
    /Invalid ATProto label creation timestamp/u
  );
});

test("isRecommendationAtprotoLabelExpired evaluates expiration boundaries", () => {
  const label = normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, exp: "2026-02-01T00:00:00Z" });

  assert.equal(isRecommendationAtprotoLabelExpired(label, "2026-01-31T23:59:59Z"), false);
  assert.equal(isRecommendationAtprotoLabelExpired(label, "2026-02-01T00:00:00Z"), true);
});

test("mergeRecommendationAtprotoLabelState preserves newer negation tombstones and newer positive labels", () => {
  const active = normalizeRecommendationAtprotoLabel(BASE_LABEL);

  assert.deepEqual(
    mergeRecommendationAtprotoLabelState({
      existing: active,
      incoming: { ...BASE_LABEL, neg: true, cts: "2026-01-02T00:00:00Z" }
    }),
    normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, neg: true, cts: "2026-01-02T00:00:00Z" })
  );

  assert.deepEqual(
    mergeRecommendationAtprotoLabelState({
      existing: active,
      incoming: { ...BASE_LABEL, cts: "2026-01-03T00:00:00Z", provenance: "subscribe_labels" }
    }),
    normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, cts: "2026-01-03T00:00:00Z", provenance: "subscribe_labels" })
  );
});

test("mergeRecommendationAtprotoLabelState keeps existing label when incoming is older", () => {
  const active = normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, cts: "2026-01-03T00:00:00Z" });

  assert.deepEqual(
    mergeRecommendationAtprotoLabelState({
      existing: active,
      incoming: { ...BASE_LABEL, neg: true, cts: "2026-01-02T00:00:00Z" }
    }),
    active
  );
});

test("mergeRecommendationAtprotoLabelState prevents out-of-order positive resurrection after tombstone", () => {
  const active = normalizeRecommendationAtprotoLabel(BASE_LABEL);
  const tombstone = mergeRecommendationAtprotoLabelState({
    existing: active,
    incoming: { ...BASE_LABEL, neg: true, cts: "2026-01-03T00:00:00Z" }
  });

  assert.deepEqual(
    mergeRecommendationAtprotoLabelState({
      existing: tombstone,
      incoming: { ...BASE_LABEL, cts: "2026-01-02T00:00:00Z" }
    }),
    normalizeRecommendationAtprotoLabel({ ...BASE_LABEL, neg: true, cts: "2026-01-03T00:00:00Z" })
  );
});

test("mergeRecommendationAtprotoLabelState rejects mismatched targets", () => {
  const active = normalizeRecommendationAtprotoLabel(BASE_LABEL);

  assert.throws(
    () =>
      mergeRecommendationAtprotoLabelState({
        existing: active,
        incoming: { ...BASE_LABEL, uri: "at://did:plc:bob/app.bsky.feed.post/xyz789" }
      }),
    /do not refer to the same label target/u
  );
});
