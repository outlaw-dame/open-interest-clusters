import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
  createRecommendationEmbeddingRecord,
  type RecommendationEmbeddingModelManifest,
  type RecommendationProfileSnapshot
} from "../src/index.js";

function model(): RecommendationEmbeddingModelManifest {
  return {
    schemaVersion: RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
    providerId: "local",
    modelId: "model",
    modelVersion: "v1",
    dimensions: 3,
    distanceMetric: "cosine"
  };
}

function profile(): RecommendationProfileSnapshot {
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: "2026-05-16T00:00:00.000Z",
    signalCount: 1,
    entries: [
      {
        target: { kind: "canonical_interest", key: "books" },
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

test("recommendation embedding lifecycle creates redacted embedding records", () => {
  const record = createRecommendationEmbeddingRecord({
    subjectId: "subject-1",
    model: model(),
    profile: profile(),
    vector: [0.1, 0.2, 0.3],
    createdAt: "2026-05-16T01:00:00.000Z"
  });

  assert.equal(record.dataUse, "embeddings");
  assert.equal(record.embeddingId.startsWith("embedding:"), true);
  assert.equal(record.subjectKey.startsWith("profile:"), true);
  assert.equal(JSON.stringify(record).includes("subject-1"), false);
});
