import test from "node:test";
import assert from "node:assert/strict";

import {
  createPgVectorMigrationPlan,
  normalizePgVectorConfig
} from "../src/index.js";

test("pgvector config normalizes valid identifiers", () => {
  const config = normalizePgVectorConfig({
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  assert.equal(config.schemaName, "public");
});

test("pgvector config rejects invalid identifiers", () => {
  assert.throws(() => {
    normalizePgVectorConfig({
      tableName: "cluster-vectors",
      idColumn: "cluster_id",
      vectorColumn: "embedding",
      dimensions: 768,
      distanceMetric: "cosine"
    });
  });
});

test("pgvector migration plan generates deterministic SQL", () => {
  const plan = createPgVectorMigrationPlan({
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  assert.match(plan.extensionSql, /CREATE EXTENSION/i);
  assert.match(plan.tableSql, /vector\(768\)/i);
  assert.match(plan.indexSql, /vector_cosine_ops/i);
});
