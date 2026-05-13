import test from "node:test";
import assert from "node:assert/strict";

import { createPgVectorQueryExecutor } from "../src/index.js";

test("pgvector executor bridge normalizes rowCount safely", async () => {
  const executor = createPgVectorQueryExecutor({
    async query() {
      return {
        rows: [{ id: 1 }],
        rowCount: 3.9
      };
    }
  });

  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, 3);
  assert.deepEqual(result.rows, [{ id: 1 }]);
});

test("pgvector executor bridge omits invalid rowCount", async () => {
  const executor = createPgVectorQueryExecutor({
    async query() {
      return {
        rows: [],
        rowCount: null
      };
    }
  });

  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, undefined);
});
