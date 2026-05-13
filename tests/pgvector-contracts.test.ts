import test from "node:test";
import assert from "node:assert/strict";

import {
  createPgVectorIndexPlan,
  createPgVectorMigrationPlan,
  createPgVectorSchemaPlan,
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

test("pgvector config rejects dimensions beyond vector type limit", () => {
  assert.throws(() => {
    normalizePgVectorConfig({
      tableName: "cluster_vectors",
      idColumn: "cluster_id",
      vectorColumn: "embedding",
      dimensions: 2001,
      distanceMetric: "cosine"
    });
  });
});

test("pgvector split migration plans support bulk restore workflows", () => {
  const config = {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine" as const
  };

  const schema = createPgVectorSchemaPlan(config);
  const index = createPgVectorIndexPlan(config);

  assert.match(schema.extensionSql, /CREATE EXTENSION/i);
  assert.match(schema.tableSql, /vector\(768\)/i);
  assert.match(index.indexSql, /USING hnsw/i);
  assert.match(index.indexSql, /vector_cosine_ops/i);
});

test("pgvector migration plan remains backward compatible", () => {
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
