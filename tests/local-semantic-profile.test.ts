import test from "node:test";
import assert from "node:assert/strict";

import {
  addExplicitInterest,
  buildLocalSemanticProfile,
  createLocalPreferenceProfile,
  rerankSemanticCandidates
} from "../src/index.js";

test("local semantic profile builds from explicit interests", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  const semantic = buildLocalSemanticProfile(
    profile,
    {
      "gaming.playstation": {
        values: [1, 0]
      }
    },
    3
  );

  assert.ok(semantic);
  assert.deepEqual(semantic?.vector.values, [25, 0]);
});

test("semantic reranking boosts aligned candidates", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  const semantic = buildLocalSemanticProfile(
    profile,
    {
      "gaming.playstation": {
        values: [1, 0]
      }
    },
    3
  );

  const ranked = rerankSemanticCandidates(semantic, [
    {
      clusterId: "books",
      vector: {
        values: [0, 1]
      },
      score: 1
    },
    {
      clusterId: "gaming.playstation",
      vector: {
        values: [1, 0]
      },
      score: 1
    }
  ]);

  assert.equal(ranked[0]?.clusterId, "gaming.playstation");
});

test("semantic profile rejects non-finite vectors", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  assert.throws(() => {
    buildLocalSemanticProfile(profile, {
      "gaming.playstation": {
        values: [1, Number.NaN]
      }
    });
  });
});
