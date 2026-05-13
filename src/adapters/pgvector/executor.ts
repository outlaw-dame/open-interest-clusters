import type { PgVectorQueryExecutor, PgVectorQueryResult } from "./provider.js";

export interface PgVectorPoolLikeResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PgVectorPoolLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[]
  ): Promise<PgVectorPoolLikeResult<Row>>;
}

export function createPgVectorQueryExecutor(pool: PgVectorPoolLike): PgVectorQueryExecutor {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[]
    ): Promise<PgVectorQueryResult<Row>> {
      const result = await pool.query<Row>(sql, params);
      const rowCount = typeof result.rowCount === "number" && Number.isFinite(result.rowCount)
        ? Math.max(0, Math.floor(result.rowCount))
        : undefined;

      if (rowCount === undefined) {
        return {
          rows: result.rows
        };
      }

      return {
        rows: result.rows,
        rowCount
      };
    }
  };
}
