import test from "node:test";
import assert from "node:assert/strict";

import {
  projectRecommendationExplanation,
  type LocalPreferenceExplanation
} from "../src/index.js";

function createExplanation(
  reason: LocalPreferenceExplanation["reason"]
): LocalPreferenceExplanation {
  return {
    clusterId: "gaming.playstation",
    weight: 50,
    banditScore: 0.5,
    reason
  };
}

test("recommendation explanations project bounded components", () => {
  const projected = projectRecommendationExplanation(
    createExplanation("combined")
  );

  assert.ok(projected.components.length <= 8);
  assert.equal(projected.clusterId, "gaming.playstation");
});

test("recommendation explanations produce stable summaries", () => {
  const projected = projectRecommendationExplanation(
    createExplanation("explicit_interest")
  );

  assert.match(projected.summary, /explicit local interests/i);
});

test("recommendation explanations clamp confidence", () => {
  const projected = projectRecommendationExplanation({
    clusterId: "gaming.playstation",
    weight: 10_000,
    banditScore: 100,
    reason: "combined"
  });

  assert.equal(projected.confidence, 1);
});
