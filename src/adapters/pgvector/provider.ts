import type {
  AnnIndexStats,
  AnnProvider,
  AnnSearchOptions,
  AnnSearchResult
} from "../../ann/types.js";
import type { EmbeddingVector } from "../../embedding/types.js";
import {
  normalizePgVectorConfig,
  type PgVectorAnnConfig
} from "./types.js";

export interface PgVectorQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number;
}

export interface PgVectorQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[]
  ): Promise<PgVectorQueryResult<Row>>;
}

export interface PgVectorAnnProviderOptions {
  maxSearchResults?: number;
}

const DEFAULT_MAX_SEARCH_RESULTS = 1_000;

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

export class PgVectorAnnProvider implements AnnProvider {
  public readonly config: Required<PgVectorAnnConfig>;
  public readonly maxSearchResults: number;
  private readonly executor: PgVectorQueryExecutor;

  constructor(
    executor: PgVectorQueryExecutor,
    config: PgVectorAnnConfig,
    options: PgVectorAnnProviderOptions = {}
  ) {
    this.config = normalizePgVectorConfig(config);
    this.executor = executor;
    this.maxSearchResults = boundedPositiveInteger(
      options.maxSearchResults,
      DEFAULT_MAX_SEARCH_RESULTS,
      1,
      DEFAULT_MAX_SEARCH_RESULTS
    );
  }

  async upsert(_clusterId: string, _vector: EmbeddingVector): Promise<void> {
    throw new Error("PgVectorAnnProvider upsert is not implemented in this slice");
  }

  async delete(_clusterId: string): Promise<boolean> {
    throw new Error("PgVectorAnnProvider delete is not implemented in this slice");
  }

  async search(
    _vector: EmbeddingVector,
    _options: AnnSearchOptions = {}
  ): Promise<AnnSearchResult[]> {
    throw new Error("PgVectorAnnProvider search is not implemented in this slice");
  }

  async stats(): Promise<AnnIndexStats> {
    const result = await this.executor.query<{ size: unknown }>(
      `SELECT COUNT(*)::int AS size FROM "${this.config.schemaName}"."${this.config.tableName}";`,
      []
    );

    const first = result.rows[0];
    const size = first ? Number(first.size) : 0;

    return {
      size: Number.isFinite(size) ? size : 0,
      dimensions: this.config.dimensions
    };
  }
}
