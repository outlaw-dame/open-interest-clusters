import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationExecutionOrchestrator,
  type RecommendationExecutionContext,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const PROFILE: RecommendationProfileSnapshot = Object.freeze({
  schemaVersion: "recommendation-profile.v1",
  updatedAt: "2026-08-05T15:30:00.000Z",
  signalCount: 3,
  entries: Object.freeze([])
});

function engine() {
  return {
    async readProfile(subjectId: string) {
      assert.equal(subjectId, "subject-1");
      return PROFILE;
    }
  };
}

test("execution orchestrator composes profile, scoring, reranking, explanations, and serving", async () => {
  let scoringContext: RecommendationExecutionContext | undefined;
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput(context) {
      scoringContext = context;
      return {
        deterministic: new Map([
          ["cluster.a", 0.8],
          ["cluster.b", 0.75],
          ["cluster.c", 0.7]
        ])
      };
    },
    rerank: {
      enabled: true,
      resolveMetadata(clusterIds) {
        assert.deepEqual([...clusterIds].sort(), ["cluster.a", "cluster.c"]);
        return [
          { clusterId: "cluster.a", category: "technology", seenRecently: true },
          { clusterId: "cluster.c", category: "science", seenRecently: false }
        ];
      }
    },
    resolveExplanations(candidates) {
      assert.deepEqual(candidates.map((candidate) => candidate.clusterId).sort(), ["cluster.a", "cluster.c"]);
      return new Map(candidates.map((candidate) => [candidate.clusterId, {
        clusterId: candidate.clusterId,
        summary: `Recommended from ${candidate.clusterId}`,
        components: [{ label: "hybrid", contribution: candidate.score }],
        confidence: 0.8
      }]));
    }
  });

  const result = await orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-1",
    limit: 2,
    excludeClusterIds: ["cluster.b"]
  });

  assert.equal(scoringContext?.profile, PROFILE);
  assert.equal(scoringContext?.subjectId, "subject-1");
  assert.equal(result.profileUpdatedAt, PROFILE.updatedAt);
  assert.equal(result.profileSignalCount, 3);
  assert.equal(result.scoredCandidateCount, 3);
  assert.equal(result.response.candidates.length, 2);
  assert.equal(result.response.candidates.some((candidate) => candidate.clusterId === "cluster.b"), false);
  assert.equal(result.response.candidates.every((candidate) => candidate.explanation !== undefined), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.response), true);
  assert.equal(Object.isFrozen(result.response.candidates), true);
});

test("execution orchestrator excludes candidates before diversity reranking", async () => {
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput() {
      return {
        deterministic: new Map([
          ["cluster.excluded", 1],
          ["cluster.eligible", 0.9],
          ["cluster.other", 0.85]
        ])
      };
    },
    rerank: {
      enabled: true,
      weights: { relevance: 1, diversity: 0.2, novelty: 0 },
      resolveMetadata(clusterIds) {
        assert.deepEqual(clusterIds, ["cluster.eligible", "cluster.other"]);
        return [
          { clusterId: "cluster.eligible", category: "technology" },
          { clusterId: "cluster.other", category: "science" }
        ];
      }
    }
  });

  const result = await orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-exclusion-rerank",
    limit: 1,
    excludeClusterIds: ["cluster.excluded"]
  });

  assert.equal(result.scoredCandidateCount, 3);
  assert.equal(result.response.candidates[0]?.clusterId, "cluster.eligible");
});

test("execution orchestrator returns an empty response when no scoring component yields candidates", async () => {
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput() {
      return {};
    }
  });

  const result = await orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-empty"
  });

  assert.equal(result.scoredCandidateCount, 0);
  assert.deepEqual(result.response.candidates, []);
});

test("execution orchestrator rejects non-finite scores before explanation or serving", async () => {
  let explanationCalls = 0;
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput() {
      return { deterministic: new Map([["cluster.a", Number.NaN]]) };
    },
    resolveExplanations() {
      explanationCalls += 1;
      return new Map();
    }
  });

  await assert.rejects(() => orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-invalid"
  }), /score component/u);
  assert.equal(explanationCalls, 0);
});

test("execution orchestrator rejects metadata for candidates outside the scored set", async () => {
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput() {
      return { deterministic: new Map([["cluster.a", 0.5]]) };
    },
    rerank: {
      enabled: true,
      resolveMetadata() {
        return [{ clusterId: "cluster.unknown", category: "unknown" }];
      }
    }
  });

  await assert.rejects(() => orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-metadata"
  }), /unknown candidate/u);
});

test("execution orchestrator rejects explanations not bound to scored candidates", async () => {
  const orchestrator = createRecommendationExecutionOrchestrator({
    engine: engine(),
    buildScoringInput() {
      return { deterministic: new Map([["cluster.a", 0.5]]) };
    },
    resolveExplanations() {
      return new Map([["cluster.a", {
        clusterId: "cluster.other",
        summary: "mismatch",
        components: [],
        confidence: 0.5
      }]]);
    }
  });

  await assert.rejects(() => orchestrator.execute({
    subjectId: "subject-1",
    requestId: "request-explanation"
  }), /not bound/u);
});