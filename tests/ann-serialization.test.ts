import test from "node:test";
import assert from "node:assert/strict";

import {
  createAnnSnapshot,
  InMemoryAnnProvider,
  parseAnnSnapshot,
  restoreAnnSnapshot,
  serializeAnnSnapshot
} from "../src/index.js";

test("ANN snapshots serialize and restore deterministically", async () => {
  const provider = new InMemoryAnnProvider();

  await provider.upsert("gaming", {
    values: [1, 0]
  });

  const snapshot = createAnnSnapshot(provider.snapshotEntries());
  const restored = parseAnnSnapshot(
    serializeAnnSnapshot(snapshot)
  );

  const target = new InMemoryAnnProvider();
  await restoreAnnSnapshot(target, restored);

  const stats = await target.stats();

  assert.equal(stats.size, 1);
  assert.equal(stats.dimensions, 2);
});

test("ANN snapshots reject duplicate cluster ids", () => {
  assert.throws(() => {
    createAnnSnapshot([
      {
        clusterId: "gaming",
        vector: {
          values: [1, 0]
        }
      },
      {
        clusterId: "gaming",
        vector: {
          values: [1, 0]
        }
      }
    ]);
  });
});

test("ANN snapshots reject malformed vectors", () => {
  assert.throws(() => {
    createAnnSnapshot([
      {
        clusterId: "gaming",
        vector: {
          values: [1, Number.NaN]
        }
      }
    ]);
  });
});

test("ANN snapshots reject schema mismatch", () => {
  assert.throws(() => {
    parseAnnSnapshot(
      JSON.stringify({
        schemaVersion: "invalid",
        entries: []
      })
    );
  });
});
