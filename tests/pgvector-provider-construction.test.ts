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
      rows: [{ size: 12 } as unknown as Row]
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

test("pgvector provider upsert validates vectors and executes", async () => {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];

  const recordingExecutor: PgVectorQueryExecutor = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[]
    ): Promise<PgVectorQueryResult<Row>> {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };

  const provider = new PgVectorAnnProvider(recordingExecutor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 3,
    distanceMetric: "cosine"
  });

  await provider.upsert("gaming", { values: [1, 2, 3] });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO/);
  assert.deepEqual(calls[0].params, ["gaming", "[1,2,3]"]);
});

test("pgvector provider rejects invalid vectors", async () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 3,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.upsert("gaming", { values: [1, 2] }));
  await assert.rejects(() => provider.upsert("gaming", { values: [1, Number.NaN, 3] }));
});

test("pgvector provider delete returns true when rows deleted", async () => {
  const deletingExecutor: PgVectorQueryExecutor = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorQueryResult<Row>> {
      return {
        rows: [],
        rowCount: 1
      };
    }
  };

  const provider = new PgVectorAnnProvider(deletingExecutor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  const deleted = await provider.delete("gaming");
  assert.equal(deleted, true);
});

test("pgvector provider rejects invalid cluster ids", async () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.delete(""));
});

test("pgvector provider does not retry non retryable errors", async () => {
  let attempts = 0;

  const failingExecutor: PgVectorQueryExecutor = {
    async query() {
      attempts += 1;
      throw Object.assign(new Error("bad sql"), { code: "42601" });
    }
  };

  const provider = new PgVectorAnnProvider(failingExecutor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.stats());
  assert.equal(attempts, 1);
});

test("pgvector provider search remains intentionally unimplemented", async () => {
  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 768,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.search({ values: [1] }));
});
