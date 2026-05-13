import test from "node:test";
import assert from "node:assert/strict";

import * as pkg from "../src/index.js";

test("pgvector public exports remain available", () => {
  assert.ok(pkg.PgVectorAnnProvider);
});
