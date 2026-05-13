import test from "node:test";
import assert from "node:assert/strict";

import {
  createAnnSnapshot,
  restorePgVectorSnapshot,
  snapshotToPgVectorRecords,
  type AnnProvider
} from "../src/index.js";

test("snapshotToPgVectorRecords produces safe copies", () => {
  const snapshot = createAnnSnapshot([
    {
      clusterId: "books",
      vector: { values: [1, 2, 3] }
    }
  ]);

  const records = snapshotToPgVectorRecords(snapshot);

  assert.deepEqual(records, [
    {
      clusterId: "books",
      values: [1, 2, 3]
    }
  ]);

  records[0]?.values.push(999);

  assert.deepEqual(snapshot.entries[0]?.vector.values, [1, 2, 3]);
});

test("restorePgVectorSnapshot restores in bounded batches with progress", async () => {
  const restored: string[] = [];
  const progress: Array<[number, number]> = [];

  const provider: AnnProvider = {
    async upsert(clusterId, vector) {
      restored.push(`${clusterId}:${vector.values.join(',')}`);
    },
    async delete() {
      return true;
    },
    async search() {
      return [];
    },
    async stats() {
      return { size: 0, dimensions: 3 };
    }
  };

  const snapshot = createAnnSnapshot([
    { clusterId: "a", vector: { values: [1, 2, 3] } },
    { clusterId: "b", vector: { values: [4, 5, 6] } },
    { clusterId: "c", vector: { values: [7, 8, 9] } }
  ]);

  const result = await restorePgVectorSnapshot(provider, snapshot, {
    batchSize: 2,
    onBatchRestored(restoredCount, total) {
      progress.push([restoredCount, total]);
    }
  });

  assert.equal(result.restored, 3);
  assert.equal(result.total, 3);
  assert.equal(result.dimensions, 3);
  assert.equal(restored.length, 3);
  assert.deepEqual(progress, [
    [2, 3],
    [3, 3]
  ]);
});
