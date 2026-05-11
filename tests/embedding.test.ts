import test from "node:test";
import assert from "node:assert/strict";

import {
  ClusterEmbeddingIndex,
  cosineSimilarity,
  hybridScore
} from "../src/index.js";

test("cosine similarity returns expected semantic ordering", () => {
  const similarity = cosineSimilarity(
    { values: [1, 0] },
    { values: [0.9, 0.1] }
  );

  assert.ok(similarity > 0.9);
});

test("cosine similarity rejects invalid vectors", () => {
  assert.throws(() => {
    cosineSimilarity(
      { values: [] },
      { values: [] }
    );
  });
});

test("cluster embedding index ranks nearest vectors first", () => {
  const index = new ClusterEmbeddingIndex([
    {
      clusterId: "gaming.playstation.ps5",
      vector: { values: [1, 0] }
    },
    {
      clusterId: "fitness.general",
      vector: { values: [0, 1] }
    }
  ]);

  const results = index.search({ values: [0.95, 0.05] });

  assert.equal(results[0]?.clusterId, "gaming.playstation.ps5");
});

test("hybrid scoring integrates bounded embedding similarity", () => {
  const ranked = hybridScore({
    deterministic: new Map([
      ["gaming.playstation.ps5", 10]
    ]),
    embeddingSimilarity: new Map([
      ["gaming.playstation.ps5", 0.9]
    ])
  });

  assert.ok((ranked[0]?.components.embedding ?? 0) > 0);
  assert.ok((ranked[0]?.score ?? 0) > 10);
});
