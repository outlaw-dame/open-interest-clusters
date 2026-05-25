import type { InterestCluster, InterestClusterDataset } from "../types/schema.js";
import { boundedInteger, executeWithRetry } from "../utils/retry-policy.js";
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
  isRetryableError?: (error: unknown) => boolean;
}

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_CONCURRENT_BATCHES = 2;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 200;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

export class EmbeddingOrchestrator {
  private readonly provider: EmbeddingProvider;
  private readonly batchSize: number;
  private readonly maxConcurrentBatches: number;
  private readonly retryAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly isRetryableError: (error: unknown) => boolean;

  public constructor(provider: EmbeddingProvider, options: EmbeddingOrchestratorOptions = {}) {
    this.provider = provider;
    this.batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 128);
    this.maxConcurrentBatches = boundedInteger(options.maxConcurrentBatches, DEFAULT_MAX_CONCURRENT_BATCHES, 1, 8);
    this.retryAttempts = boundedInteger(options.retryAttempts, DEFAULT_RETRY_ATTEMPTS, 1, 8);
    this.initialRetryDelayMs = boundedInteger(options.initialRetryDelayMs, DEFAULT_INITIAL_RETRY_DELAY_MS, 10, 30_000);
    this.maxRetryDelayMs = Math.max(
      this.initialRetryDelayMs,
      boundedInteger(options.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS, 10, 120_000)
    );
    this.isRetryableError = options.isRetryableError ?? (() => true);
  }

  public async generateClusterEmbeddings(
    dataset: InterestClusterDataset
  ): Promise<ClusterEmbeddingDocument[]> {
    return this.generateClusterEmbeddingsForClusters(dataset.clusters);
  }

  public async generateClusterEmbeddingsForClusters(
    clusters: readonly InterestCluster[]
  ): Promise<ClusterEmbeddingDocument[]> {
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

  private async embedClusterBatch(clusters: readonly InterestCluster[]): Promise<ClusterEmbeddingDocument[]> {
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
    return executeWithRetry(
      async () => this.provider.embedBatch(texts),
      {
        attempts: this.retryAttempts,
        initialDelayMs: this.initialRetryDelayMs,
        maxDelayMs: this.maxRetryDelayMs,
        shouldRetry: ({ error }) => this.isRetryableError(error)
      }
    );
  }
}
