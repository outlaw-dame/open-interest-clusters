import test from "node:test";
import assert from "node:assert/strict";

import {
  PgVectorAnnProvider,
  type PgVectorQueryExecutor,
  type PgVectorQueryResult
} from "../src/index.js";

const executor: PgVectorQueryExecutor = {
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorQueryResult<Row>> {
    return {
      rows: [{ size: 12 } as Row]
    };
  }
};

test("pgvector provider normalizes config and stats", async () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  assert.equal(provider.config.schemaName, "public");
  assert.equal(provider.maxSearchResults, 1000);

  const stats = await provider.stats();

  assert.equal(stats.size, 12);
  assert.equal(stats.dimensions, 768);
});

test("pgvector provider bounds max search results", () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  }, {
    maxSearchResults: 50000
  });

  assert.equal(provider.maxSearchResults, 1000);
});

test("pgvector provider throws for unimplemented methods in slice 1", async () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.upsert("gaming", { values: [1] }));
  await assert.rejects(() => provider.delete("gaming"));
  await assert.rejects(() => provider.search({ values: [1] }));
});
