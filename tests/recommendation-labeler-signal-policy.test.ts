import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecommendationConsent } from "../src/recommendation/consent.js";
import {
  evaluateRecommendationLabelerSignalPolicy,
  inferRecommendationLabelTarget,
  normalizeRecommendationUserLabelerSubscription
} from "../src/recommendation/labeler-signal-policy.js";

const SUBJECT_ID = "did:plc:user123";
const LABELER_DID = "did:plc:labeler123";
const OTHER_LABELER_DID = "did:plc:otherlabeler123";
const NOW = "2026-01-15T00:00:00Z";

const ALLOW_CONSENT = evaluateRecommendationConsent(
  {
    subjectId: SUBJECT_ID,
    allowedDataUses: ["local_personalization"],
    privateDataUses: ["local_personalization"]
  },
  {
    subjectId: SUBJECT_ID,
    dataUse: "local_personalization",
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo"
  }
);

const DENY_CONSENT = evaluateRecommendationConsent(null, {
  subjectId: SUBJECT_ID,
  dataUse: "local_personalization",
  protocol: "atproto",
  sourceVisibility: "atproto_public_repo",
  accessBasis: "atproto_public_repo"
});

const SUBSCRIPTION = Object.freeze({
  subjectId: SUBJECT_ID,
  labelerDid: LABELER_DID,
  source: "atproto" as const,
  subscribedAt: "2026-01-01T00:00:00Z"
});

const BASE_LABEL = Object.freeze({
  src: LABELER_DID,
  uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
  cid: "bafyreibasecid123",
  val: "sports",
  cts: "2026-01-10T00:00:00Z",
  provenance: "subscribe_labels" as const
});

test("inferRecommendationLabelTarget distinguishes repository targets", () => {
  assert.deepEqual(inferRecommendationLabelTarget("did:plc:alice"), {
    kind: "repository",
    uri: "did:plc:alice"
  });

  assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice"), {
    kind: "repository",
    uri: "at://did:plc:alice"
  });
});

test("inferRecommendationLabelTarget does not misclassify malformed or collection-only AT URIs as records", async (t) => {
  await t.test("missing authority", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://"), {
      kind: "unknown",
      uri: "at://"
    });
  });

  await t.test("empty collection", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/"), {
      kind: "repository",
      uri: "at://did:plc:alice/"
    });
  });

  await t.test("collection without record key", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/app.bsky.feed.post"), {
      kind: "unknown",
      uri: "at://did:plc:alice/app.bsky.feed.post"
    });
  });
});

test("inferRecommendationLabelTarget distinguishes known ATProto record targets", async (t) => {
  await t.test("post", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/app.bsky.feed.post/abc123", "bafypost"), {
      kind: "record",
      uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
      cid: "bafypost",
      recordKind: "post",
      collection: "app.bsky.feed.post"
    });
  });

  await t.test("feed", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/app.bsky.feed.generator/main"), {
      kind: "record",
      uri: "at://did:plc:alice/app.bsky.feed.generator/main",
      recordKind: "feed",
      collection: "app.bsky.feed.generator"
    });
  });

  await t.test("list", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/app.bsky.graph.list/list123"), {
      kind: "record",
      uri: "at://did:plc:alice/app.bsky.graph.list/list123",
      recordKind: "list",
      collection: "app.bsky.graph.list"
    });
  });

  await t.test("starter pack", () => {
    assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/app.bsky.graph.starterpack/pack123"), {
      kind: "record",
      uri: "at://did:plc:alice/app.bsky.graph.starterpack/pack123",
      recordKind: "starter_pack",
      collection: "app.bsky.graph.starterpack"
    });
  });
});

test("inferRecommendationLabelTarget treats unknown ATProto collections as custom records", () => {
  assert.deepEqual(inferRecommendationLabelTarget("at://did:plc:alice/com.example.custom.record/key123"), {
    kind: "record",
    uri: "at://did:plc:alice/com.example.custom.record/key123",
    recordKind: "custom",
    collection: "com.example.custom.record"
  });
});

test("inferRecommendationLabelTarget treats non-AT URI with CID as blob target", () => {
  assert.deepEqual(inferRecommendationLabelTarget("blob:sha256:abc123", "bafyblob"), {
    kind: "blob",
    uri: "blob:sha256:abc123",
    cid: "bafyblob"
  });
});

test("evaluateRecommendationLabelerSignalPolicy accepts subscribed labeler evidence", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    subscription: SUBSCRIPTION,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "accept");
  assert.equal(evaluation.reasonCode, "labeler.accept.subscribed_evidence");
  assert.deepEqual(evaluation.evidence, {
    subjectId: SUBJECT_ID,
    labelerDid: LABELER_DID,
    target: {
      kind: "record",
      uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
      cid: "bafyreibasecid123",
      recordKind: "post",
      collection: "app.bsky.feed.post"
    },
    value: "sports",
    negated: false,
    provenance: "subscribe_labels",
    createdAt: "2026-01-10T00:00:00Z",
    subscriptionSource: "atproto"
  });
});

test("evaluateRecommendationLabelerSignalPolicy ignores labels without subscription evidence", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    consentEvaluation: ALLOW_CONSENT
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.not_subscribed");
  assert.equal(evaluation.evidence, undefined);
});

test("evaluateRecommendationLabelerSignalPolicy ignores revoked subscriptions", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    subscription: { ...SUBSCRIPTION, revokedAt: "2026-01-12T00:00:00Z" },
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.subscription_revoked");
});

test("evaluateRecommendationLabelerSignalPolicy ignores consent denied labels", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    subscription: SUBSCRIPTION,
    consentEvaluation: DENY_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.consent_denied");
});

test("evaluateRecommendationLabelerSignalPolicy ignores labeler DID mismatches", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: { ...BASE_LABEL, src: OTHER_LABELER_DID },
    subscription: SUBSCRIPTION,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.labeler_mismatch");
});

test("evaluateRecommendationLabelerSignalPolicy preserves expired label reason", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: { ...BASE_LABEL, exp: "2026-01-14T00:00:00Z" },
    subscription: SUBSCRIPTION,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.expired_label");
});

test("evaluateRecommendationLabelerSignalPolicy ignores negated labels", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: { ...BASE_LABEL, neg: true },
    subscription: SUBSCRIPTION,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.negated_label");
});

test("normalizeRecommendationUserLabelerSubscription rejects malformed and unsafe values", async (t) => {
  await t.test("malformed DID", () => {
    assert.throws(
      () => normalizeRecommendationUserLabelerSubscription({ ...SUBSCRIPTION, labelerDid: "not-a-did" }),
      /Invalid recommendation labeler DID/u
    );
  });

  await t.test("unsafe control character", () => {
    assert.throws(
      () => normalizeRecommendationUserLabelerSubscription({ ...SUBSCRIPTION, subjectId: `user${String.fromCharCode(0)}id` }),
      /Invalid recommendation labeler subject ID/u
    );
  });

  await t.test("malformed timestamp", () => {
    assert.throws(
      () => normalizeRecommendationUserLabelerSubscription({ ...SUBSCRIPTION, subscribedAt: "not-a-date" }),
      /Invalid recommendation labeler subscription timestamp/u
    );
  });
});

test("evaluateRecommendationLabelerSignalPolicy treats subject mismatches as not subscribed", () => {
  const evaluation = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    subscription: { ...SUBSCRIPTION, subjectId: "did:plc:otheruser123" },
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(evaluation.decision, "ignore");
  assert.equal(evaluation.reasonCode, "labeler.ignore.not_subscribed");
});
