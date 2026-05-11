import { setTimeout as sleep } from "node:timers/promises";

import type { InterestClusterDataset } from "../types/schema.js";
import type { EmbeddingProvider, EmbeddingResult } from "./types.js";
import { clusterToEmbeddingText } from "./text.js";

export interface ClusterEmbeddingDocument {
  clusterId: string;
  text: string;
  embedding: EmbeddingResult;
  generatedAt: number;
}

export interface EmbeddingOrchestratorOptions {
  batchSize?: number;
  maxConcurrentBatches?: number;
  retryAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_CONCURRENT_BATCHES = 2;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 200;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

function boundedPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

function jitteredBackoff(delayMs: number, maxDelayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delayMs * 0.2)));
  return Math.min(maxDelayMs, delayMs + jitter);
}

export class EmbeddingOrchestrator {
  private readonly provider: EmbeddingProvider;
  private readonly batchSize: number;
  private readonly maxConcurrentBatches: number;
  private readonly retryAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  public constructor(provider: EmbeddingProvider, options: EmbeddingOrchestratorOptions = {}) {
    this.provider = provider;
    this.batchSize = boundedPositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 128);
    this.maxConcurrentBatches = boundedPositiveInteger(options.maxConcurrentBatches, DEFAULT_MAX_CONCURRENT_BATCHES, 1, 8);
    this.retryAttempts = boundedPositiveInteger(options.retryAttempts, DEFAULT_RETRY_ATTEMPTS, 1, 8);
    this.initialRetryDelayMs = boundedPositiveInteger(options.initialRetryDelayMs, DEFAULT_INITIAL_RETRY_DELAY_MS, 10, 30_000);
    this.maxRetryDelayMs = Math.max(
      this.initialRetryDelayMs,
      boundedPositiveInteger(options.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS, 10, 120_000)
    );
  }

  public async generateClusterEmbeddings(
    dataset: InterestClusterDataset
  ): Promise<ClusterEmbeddingDocument[]> {
    const clusters = dataset.clusters;
    const documents: ClusterEmbeddingDocument[] = [];

    for (let index = 0; index < clusters.length; index += this.batchSize * this.maxConcurrentBatches) {
      const concurrentSlices: Promise<ClusterEmbeddingDocument[]>[] = [];

      for (let offset = 0; offset < this.maxConcurrentBatches; offset += 1) {
        const start = index + offset * this.batchSize;
        const batch = clusters.slice(start, start + this.batchSize);

        if (batch.length === 0) {
          continue;
        }

        concurrentSlices.push(this.embedClusterBatch(batch));
      }

      const resolved = await Promise.all(concurrentSlices);

      for (const slice of resolved) {
        documents.push(...slice);
      }
    }

    return documents;
  }

  private async embedClusterBatch(clusters: InterestClusterDataset["clusters"]): Promise<ClusterEmbeddingDocument[]> {
    const texts = clusters.map((cluster) => clusterToEmbeddingText(cluster));
    const embeddings = await this.embedBatchWithRetry(texts);

    if (embeddings.length !== clusters.length) {
      throw new Error(`Embedding provider returned ${embeddings.length} result(s) for ${clusters.length} input(s)`);
    }

    const generatedAt = Date.now();

    return clusters.map((cluster, index) => {
      const text = texts[index];
      const embedding = embeddings[index];

      if (!text || !embedding) {
        throw new Error(`Missing embedding output for cluster ${cluster.id}`);
      }

      return {
        clusterId: cluster.id,
        text,
        embedding,
        generatedAt
      };
    });
  }

  private async embedBatchWithRetry(texts: readonly string[]): Promise<EmbeddingResult[]> {
    let delayMs = this.initialRetryDelayMs;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await this.provider.embedBatch(texts);
      } catch (error) {
        lastError = error;

        if (attempt === this.retryAttempts) {
          break;
        }

        await sleep(jitteredBackoff(delayMs, this.maxRetryDelayMs));
        delayMs = Math.min(this.maxRetryDelayMs, delayMs * 2);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Embedding provider failed for an unknown reason");
  }
}
