import test from "node:test";
import assert from "node:assert/strict";

import {
  checkPGliteAnnHealth,
  createAnnSnapshot,
  rebuildPGliteFromSnapshot,
  type AnnProvider
} from "../src/index.js";

test("PGlite health check returns stats when provider is healthy", async () => {
  const provider: AnnProvider = {
    async upsert() {},
    async delete() { return true; },
    async search() { return []; },
    async stats() {
      return { size: 4, dimensions: 3 };
    }
  };

  const result = await checkPGliteAnnHealth(provider);

  assert.equal(result.ok, true);
  assert.equal(result.stats?.size, 4);
});

test("PGlite rebuild enforces expected dimensions", async () => {
  const provider: AnnProvider = {
    async upsert() {},
    async delete() { return true; },
    async search() { return []; },
    async stats() {
      return { size: 0, dimensions: 3 };
    }
  };

  const snapshot = createAnnSnapshot([
    { clusterId: "books", vector: { values: [1, 2, 3] } }
  ]);

  await assert.rejects(() => rebuildPGliteFromSnapshot(provider, snapshot, {
    expectedDimensions: 768
  }));
});
