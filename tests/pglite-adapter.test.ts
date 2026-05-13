import test from "node:test";
import assert from "node:assert/strict";

import {
  createPGliteExecutor,
  type PGliteLike,
  type PgVectorPoolLikeResult
} from "../src/index.js";

test("PGlite adapter reuses pgvector executor contract", async () => {
  const client: PGliteLike = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      _sql: string,
      _params: readonly unknown[]
    ): Promise<PgVectorPoolLikeResult<Row>> {
      return {
        rows: [{ ok: true } as unknown as Row],
        rowCount: 1
      };
    }
  };

  const executor = createPGliteExecutor(client);
  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows, [{ ok: true }]);
});
