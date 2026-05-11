import test from "node:test";
import assert from "node:assert/strict";

import {
  ClusterEmbeddingIndex,
  restoreEmbeddingIndex,
  snapshotEmbeddingIndex
} from "../src/index.js";

test("embedding snapshot restores deterministically", () => {
  const index = new ClusterEmbeddingIndex();

  index.set("gaming", {
    values: [1, 2, 3]
  });

  const snapshot = snapshotEmbeddingIndex(index);
  const restored = restoreEmbeddingIndex(snapshot);

  assert.deepEqual(restored.get("gaming"), {
    values: [1, 2, 3]
  });
});

test("embedding snapshot rejects non-finite vectors", () => {
  const index = new ClusterEmbeddingIndex();

  index.set("broken", {
    values: [1, Number.NaN]
  });

  assert.throws(() => {
    snapshotEmbeddingIndex(index);
  });
});

test("embedding snapshot rejects invalid schema version", () => {
  assert.throws(() => {
    restoreEmbeddingIndex({
      schemaVersion: "invalid" as never,
      generatedAt: new Date().toISOString(),
      embeddings: []
    });
  });
});
