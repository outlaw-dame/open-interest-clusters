import { setTimeout as sleep } from "node:timers/promises";

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
import {
  serializePgVectorEmbedding,
  validatePgVectorEmbedding
} from "./vector-utils.js";

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
  retryAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

const DEFAULT_MAX_SEARCH_RESULTS = 1_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const MAX_CLUSTER_ID_LENGTH = 512;
const RETRYABLE_ERROR_CODES = new Set([
  "40001",
  "40P01",
  "53300",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE"
]);

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

function validateClusterId(clusterId: string): void {
  if (!clusterId || clusterId.length > MAX_CLUSTER_ID_LENGTH || /[\u0000-\u001F\u007F]/u.test(clusterId)) {
    throw new Error("Invalid pgvector cluster id");
  }
}

function isRetryablePgVectorError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as Error & { code?: unknown }).code;
  return typeof maybeCode === "string" && RETRYABLE_ERROR_CODES.has(maybeCode);
}

function retryDelayMs(baseDelayMs: number, maxDelayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs * 0.2)));
  return Math.min(maxDelayMs, baseDelayMs + jitter);
}

export class PgVectorAnnProvider implements AnnProvider {
  public readonly config: Required<PgVectorAnnConfig>;
  public readonly maxSearchResults: number;
  private readonly executor: PgVectorQueryExecutor;
  private readonly retryAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;

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
    this.retryAttempts = boundedPositiveInteger(options.retryAttempts, DEFAULT_RETRY_ATTEMPTS, 1, 8);
    this.initialRetryDelayMs = boundedPositiveInteger(
      options.initialRetryDelayMs,
      DEFAULT_INITIAL_RETRY_DELAY_MS,
      1,
      30_000
    );
    this.maxRetryDelayMs = boundedPositiveInteger(
      options.maxRetryDelayMs,
      DEFAULT_MAX_RETRY_DELAY_MS,
      this.initialRetryDelayMs,
      120_000
    );
  }

  async upsert(_clusterId: string, _vector: EmbeddingVector): Promise<void> {
    void validatePgVectorEmbedding;
    void serializePgVectorEmbedding;
    throw new Error("PgVectorAnnProvider upsert is not implemented in this slice");
  }

  async delete(clusterId: string): Promise<boolean> {
    validateClusterId(clusterId);

    const result = await this.queryWithRetry(
      `DELETE FROM "${this.config.schemaName}"."${this.config.tableName}" WHERE "${this.config.idColumn}" = $1;`,
      [clusterId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async search(
    _vector: EmbeddingVector,
    _options: AnnSearchOptions = {}
  ): Promise<AnnSearchResult[]> {
    throw new Error("PgVectorAnnProvider search is not implemented in this slice");
  }

  async stats(): Promise<AnnIndexStats> {
    const result = await this.queryWithRetry<{ size: unknown }>(
      `SELECT COUNT(*)::int AS size FROM "${this.config.schemaName}"."${this.config.tableName}";`,
      []
    );

    const first = result.rows[0];
    const size = first ? Number(first.size) : 0;

    return {
      size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
      dimensions: this.config.dimensions
    };
  }

  private async queryWithRetry<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[]
  ): Promise<PgVectorQueryResult<Row>> {
    let delayMs = this.initialRetryDelayMs;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await this.executor.query<Row>(sql, params);
      } catch (error) {
        lastError = error;

        if (attempt >= this.retryAttempts || !isRetryablePgVectorError(error)) {
          throw error;
        }

        await sleep(retryDelayMs(delayMs, this.maxRetryDelayMs));
        delayMs = Math.min(this.maxRetryDelayMs, delayMs * 2);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("pgvector query failed");
  }
}
