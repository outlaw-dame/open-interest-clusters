import test from "node:test";
import assert from "node:assert/strict";

import { createPGliteExecutor } from "../src/index.js";
import { createMockPGliteClient } from "./helpers/mock-pgvector.js";

test("PGlite adapter reuses pgvector executor contract", async () => {
  const executor = createPGliteExecutor(createMockPGliteClient([{ ok: true }], 1));
  const result = await executor.query("SELECT 1", []);

  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows, [{ ok: true }]);
});
