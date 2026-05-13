import test from "node:test";
import assert from "node:assert/strict";

import {
  createPgVectorQueryExecutor,
  type PgVectorPoolLike,
  type PgVectorPoolLikeResult
} from "../src/index.js";

test("pgvector executor bridge normalizes rowCount safely", async () => {
  const pool: PgVectorPoolLike = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorPoolLikeResult<Row>> {
      return {
        rows: [{ id: 1 } as unknown as Row],
        rowCount: 3.9
      };
    }
  };

  const executor = createPgVectorQueryExecutor(pool);
  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, 3);
  assert.deepEqual(result.rows, [{ id: 1 }]);
});

test("pgvector executor bridge omits invalid rowCount", async () => {
  const pool: PgVectorPoolLike = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorPoolLikeResult<Row>> {
      return {
        rows: [],
        rowCount: null
      };
    }
  };

  const executor = createPgVectorQueryExecutor(pool);
  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, undefined);
});
