import test from "node:test";
import assert from "node:assert/strict";

import {
  serveCandidates,
  type HybridScoreResult,
  type RecommendationExplanation
} from "../src/index.js";

function createCandidate(
  clusterId: string,
  score: number
): HybridScoreResult {
  return {
    clusterId,
    score,
    components: {
      deterministic: score,
      entity: 0,
      graph: 0,
      embedding: 0,
      bandit: 0,
      contextual: 0,
      session: 0
    }
  };
}

test("candidate serving returns bounded ranked candidates", () => {
  const response = serveCandidates({
    requestId: "req-1",
    limit: 1,
    candidates: [
      createCandidate("books", 1),
      createCandidate("gaming", 2)
    ]
  });

  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0]?.clusterId, "gaming");
});

test("candidate serving removes duplicate cluster ids", () => {
  const response = serveCandidates({
    requestId: "req-2",
    candidates: [
      createCandidate("gaming", 1),
      createCandidate("gaming", 2)
    ]
  });

  assert.equal(response.candidates.length, 1);
});

test("candidate serving attaches explanations", () => {
  const explanation: RecommendationExplanation = {
    clusterId: "gaming",
    summary: "Ranked using local feedback.",
    confidence: 0.5,
    components: []
  };

  const response = serveCandidates({
    requestId: "req-3",
    candidates: [createCandidate("gaming", 1)],
    explanations: new Map([["gaming", explanation]])
  });

  assert.equal(response.candidates[0]?.explanation?.summary, explanation.summary);
});

test("candidate serving rejects invalid request ids", () => {
  assert.throws(() => {
    serveCandidates({
      requestId: "bad\u0000id",
      candidates: []
    });
  });
});
