import test from "node:test";
import assert from "node:assert/strict";

import {
  PgVectorAnnProvider,
  type PgVectorQueryExecutor,
  type PgVectorQueryResult
} from "../src/index.js";

test("pgvector provider retries retryable errors deterministically", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const executor: PgVectorQueryExecutor = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorQueryResult<Row>> {
      attempts += 1;

      if (attempts < 3) {
        throw Object.assign(new Error("transient"), { code: "40001" });
      }

      return {
        rows: [{ size: 5 } as unknown as Row]
      };
    }
  };

  const provider = new PgVectorAnnProvider(
    executor,
    {
      tableName: "cluster_vectors",
      idColumn: "cluster_id",
      vectorColumn: "embedding",
      dimensions: 3,
      distanceMetric: "cosine"
    },
    {
      retrySleeper: async (delayMs) => {
        delays.push(delayMs);
      },
      random: () => 0
    }
  );

  const stats = await provider.stats();

  assert.equal(stats.size, 5);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});
