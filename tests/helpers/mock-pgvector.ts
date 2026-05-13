import type {
  AnnProvider,
  EmbeddingVector,
  PgVectorPoolLike,
  PgVectorPoolLikeResult,
  PgVectorQueryExecutor,
  PgVectorQueryResult,
  PGliteLike
} from "../../src/index.js";

export function createMockPgVectorQueryExecutor<RowData extends Record<string, unknown>>(
  rows: readonly RowData[],
  rowCount?: number
): PgVectorQueryExecutor {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorQueryResult<Row>> {
      return {
        rows: rows.map((row) => ({ ...row }) as unknown as Row),
        ...(rowCount === undefined ? {} : { rowCount })
      };
    }
  };
}

export function createMockPgVectorPool<RowData extends Record<string, unknown>>(
  rows: readonly RowData[],
  rowCount?: number | null
): PgVectorPoolLike {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PgVectorPoolLikeResult<Row>> {
      return {
        rows: rows.map((row) => ({ ...row }) as unknown as Row),
        ...(rowCount === undefined ? {} : { rowCount })
      };
    }
  };
}

export function createMockPGliteClient<RowData extends Record<string, unknown>>(
  rows: readonly RowData[],
  rowCount?: number | null
): PGliteLike {
  return createMockPgVectorPool(rows, rowCount);
}

export function createMockAnnProvider(): AnnProvider & { restored: Array<{ clusterId: string; vector: EmbeddingVector }> } {
  const restored: Array<{ clusterId: string; vector: EmbeddingVector }> = [];

  return {
    restored,
    async upsert(clusterId, vector) {
      restored.push({
        clusterId,
        vector: {
          values: [...vector.values]
        }
      });
    },
    async delete() {
      return true;
    },
    async search() {
      return [];
    },
    async stats() {
      return {
        size: restored.length,
        dimensions: restored[0]?.vector.values.length ?? 0
      };
    }
  };
}
