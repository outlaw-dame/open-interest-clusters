import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
  createRecommendationEmbeddingRecord,
  evaluateRecommendationEmbeddingFreshness,
  invalidateRecommendationEmbeddingRecord,
  normalizeRecommendationEmbeddingRecord,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationEmbeddingModelManifest,
  type RecommendationProfileSnapshot
} from "../src/index.js";

function model(version = "v1"): RecommendationEmbeddingModelManifest {
  return {
    schemaVersion: RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
    providerId: "local",
    modelId: "model",
    modelVersion: version,
    dimensions: 3,
    distanceMetric: "cosine"
  };
}

function profile(key = "books"): RecommendationProfileSnapshot {
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: "2026-05-16T00:00:00.000Z",
    signalCount: 1,
    entries: [
      {
        target: { kind: "canonical_interest", key },
        score: 0.75,
        confidence: 0.8,
        signalCount: 1,
        positiveSignalCount: 1,
        negativeSignalCount: 0,
        neutralSignalCount: 0,
        privacyBoundaries: ["local_only"],
        protocols: ["activitypub"],
        sourceVisibilities: ["public"],
        updatedAt: "2026-05-16T00:00:00.000Z"
      }
    ]
  };
}

test("recommendation embedding freshness detects model, profile, privacy, and expiry changes", () => {
  const record = createRecommendationEmbeddingRecord({
    subjectId: "subject-1",
    model: model(),
    profile: profile(),
    vector: [0.1, 0.2, 0.3],
    createdAt: "2026-05-16T01:00:00.000Z",
    expiresAt: "2026-05-17T00:00:00.000Z"
  });

  assert.deepEqual(
    evaluateRecommendationEmbeddingFreshness({
      record,
      model: model(),
      profile: profile(),
      now: "2026-05-16T02:00:00.000Z"
    }),
    { stale: false, reasons: [] }
  );

  assert.deepEqual(
    evaluateRecommendationEmbeddingFreshness({
      record,
      model: model("v2"),
      profile: profile("music"),
      now: "2026-05-18T00:00:00.000Z",
      privacyBoundary: "server_allowed"
    }).reasons,
    ["expired", "model_changed", "profile_changed", "privacy_boundary_changed"]
  );
});

test("recommendation embedding invalidation hides invalidated records by default", () => {
  const record = createRecommendationEmbeddingRecord({
    subjectId: "subject-1",
    salt: "salt-1",
    model: model(),
    profile: profile(),
    vector: [0.1, 0.2, 0.3],
    createdAt: "2026-05-16T01:00:00.000Z"
  });
  const intent: RecommendationDerivedDataDeletionIntent = {
    subjectId: "subject-1",
    requestedAt: "2026-05-16T03:00:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["embeddings"]
  };
  const invalidated = invalidateRecommendationEmbeddingRecord({ record, intent, salt: "salt-1" });

  assert.equal(invalidated.invalidatedAt, intent.requestedAt);
  assert.equal(invalidated.invalidationReason, "deletion_requested");
  assert.equal(normalizeRecommendationEmbeddingRecord(invalidated), null);
  assert.equal(normalizeRecommendationEmbeddingRecord(invalidated, { includeInvalidated: true })?.invalidatedAt, intent.requestedAt);
});

test("recommendation embedding invalidation rejects mismatched deletion subjects", () => {
  const record = createRecommendationEmbeddingRecord({
    subjectId: "subject-1",
    model: model(),
    profile: profile(),
    vector: [0.1, 0.2, 0.3],
    createdAt: "2026-05-16T01:00:00.000Z"
  });
  const intent: RecommendationDerivedDataDeletionIntent = {
    subjectId: "subject-2",
    requestedAt: "2026-05-16T03:00:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["embeddings"]
  };

  assert.throws(() => invalidateRecommendationEmbeddingRecord({ record, intent }), TypeError);
});
