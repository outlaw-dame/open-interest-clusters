import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
  createRecommendationEmbeddingRecord,
  createRecommendationEmbeddingSourceFingerprint,
  normalizeRecommendationEmbeddingRecord,
  sha256Hex,
  type RecommendationEmbeddingModelManifest,
  type RecommendationEmbeddingRecord,
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

function legacyEmbeddingId(record: RecommendationEmbeddingRecord): string {
  return `embedding:${sha256Hex(JSON.stringify([
    "recommendation-embedding-id.v1",
    record.subjectKey,
    record.model.providerId,
    record.model.modelId,
    record.model.modelVersion,
    record.model.dimensions,
    record.source.profileDigest
  ]))}`;
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
  assert.throws(
    () => createRecommendationEmbeddingRecord({
      subjectId: "subject-1",
      model: { ...model(), providerId: `local${String.fromCharCode(0x80)}` },
      profile: profile(),
      vector: [0.1, 0.2, 0.3],
      createdAt: "2026-05-16T01:00:00.000Z"
    }),
    TypeError
  );
});

test("recommendation embedding source fingerprint is deterministic across object key order", () => {
  const reordered = {
    entries: [
      {
        updatedAt: "2026-05-16T00:00:00.000Z",
        sourceVisibilities: ["public"],
        protocols: ["activitypub"],
        privacyBoundaries: ["local_only"],
        neutralSignalCount: 0,
        negativeSignalCount: 0,
        positiveSignalCount: 1,
        signalCount: 1,
        confidence: 0.8,
        score: 0.75,
        target: { key: "books", kind: "canonical_interest" }
      }
    ],
    signalCount: 1,
    updatedAt: "2026-05-16T00:00:00.000Z",
    schemaVersion: "recommendation-profile.v1"
  } as RecommendationProfileSnapshot;

  assert.equal(
    createRecommendationEmbeddingSourceFingerprint(profile()).profileDigest,
    createRecommendationEmbeddingSourceFingerprint(reordered).profileDigest
  );
  assert.equal(
    createRecommendationEmbeddingRecord({
      subjectId: "subject-1",
      model: model(),
      profile: profile(),
      vector: [0.1, 0.2, 0.3],
      createdAt: "2026-05-16T01:00:00.000Z"
    }).embeddingId,
    createRecommendationEmbeddingRecord({
      subjectId: "subject-1",
      model: model(),
      profile: reordered,
      vector: [0.1, 0.2, 0.3],
      createdAt: "2026-05-16T01:00:00.000Z"
    }).embeddingId
  );
});

test("recommendation embedding normalization accepts persisted legacy v1 embedding ids", () => {
  const record = createRecommendationEmbeddingRecord({
    subjectId: "subject-1",
    model: model(),
    profile: profile(),
    vector: [0.1, 0.2, 0.3],
    createdAt: "2026-05-16T01:00:00.000Z"
  });
  const legacyRecord = {
    ...record,
    embeddingId: legacyEmbeddingId(record)
  };

  assert.notEqual(legacyRecord.embeddingId, record.embeddingId);
  assert.equal(normalizeRecommendationEmbeddingRecord(legacyRecord)?.embeddingId, legacyRecord.embeddingId);
});
