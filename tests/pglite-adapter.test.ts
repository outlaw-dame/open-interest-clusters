import test from "node:test";
import assert from "node:assert/strict";

import { createPGliteExecutor } from "../src/index.js";

test("PGlite adapter reuses pgvector executor contract", async () => {
  const executor = createPGliteExecutor({
    async query() {
      return {
        rows: [{ ok: true }],
        rowCount: 1
      };
    }
  });

  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows, [{ ok: true }]);
});
