import type { AnnProvider } from "../../ann/types.js";
import type { EmbeddingVector } from "../../embedding/types.js";
import { normalizePgVectorConfig, type PgVectorAnnConfig } from "./types.js";

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
  retryAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxSearchResults?: number;
}

export class PgVectorAnnProvider implements AnnProvider {
  private readonly config: Required<PgVectorAnnConfig>;
  private readonly executor: PgVectorQueryExecutor;

  constructor(
    executor: PgVectorQueryExecutor,
    config: PgVectorAnnConfig,
    _options: PgVectorAnnProviderOptions = {}
  ) {
    this.config = normalizePgVectorConfig(config);
    this.executor = executor;
  }

  async upsert(_clusterId: string, _vector: EmbeddingVector): Promise<void> {
    throw new Error("PgVectorAnnProvider upsert is not implemented yet");
  }

  async delete(_clusterId: string): Promise<boolean> {
    throw new Error("PgVectorAnnProvider delete is not implemented yet");
  }

  async search(): Promise<[]> {
    throw new Error("PgVectorAnnProvider search is not implemented yet");
  }

  async stats() {
    void this.executor;

    return {
      size: 0,
      dimensions: this.config.dimensions
    };
  }
}
