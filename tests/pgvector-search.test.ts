import test from "node:test";
import assert from "node:assert/strict";

import {
  PgVectorAnnProvider,
  type PgVectorQueryExecutor,
  type PgVectorQueryResult
} from "../src/index.js";

test("pgvector provider search returns deterministic filtered results", async () => {
  const searchExecutor: PgVectorQueryExecutor = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[]
    ): Promise<PgVectorQueryResult<Row>> {
      assert.match(sql, /ORDER BY similarity DESC, cluster_id ASC/);
      assert.deepEqual(params, ["[1,2,3]", 2]);

      return {
        rows: [
          { cluster_id: "books", similarity: 0.91 },
          { cluster_id: "games", similarity: 0.7 },
          { cluster_id: null, similarity: 0.99 },
          { cluster_id: "bad", similarity: Number.NaN }
        ] as unknown as Row[]
      };
    }
  };

  const provider = new PgVectorAnnProvider(searchExecutor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 3,
    distanceMetric: "cosine"
  });

  const results = await provider.search(
    { values: [1, 2, 3] },
    { limit: 2, minSimilarity: 0.8 }
  );

  assert.deepEqual(results, [
    { clusterId: "books", similarity: 0.91 }
  ]);
});

test("pgvector provider rejects invalid search inputs", async () => {
  const executor: PgVectorQueryExecutor = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorQueryResult<Row>> {
      return { rows: [] };
    }
  };

  const provider = new PgVectorAnnProvider(executor, {
    tableName: "cluster_vectors",
    idColumn: "cluster_id",
    vectorColumn: "embedding",
    dimensions: 3,
    distanceMetric: "cosine"
  });

  await assert.rejects(() => provider.search({ values: [1, Infinity, 3] }));
  await assert.rejects(() => provider.search({ values: [1, 2, 3] }, { minSimilarity: Number.NaN }));
});
