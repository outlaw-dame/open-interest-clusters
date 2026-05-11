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
}

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_CONCURRENT_BATCHES = 2;

export class EmbeddingOrchestrator {
  private readonly provider: EmbeddingProvider;
  private readonly batchSize: number;
  private readonly maxConcurrentBatches: number;

  public constructor(provider: EmbeddingProvider, options: EmbeddingOrchestratorOptions = {}) {
    this.provider = provider;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.maxConcurrentBatches = Math.max(1, options.maxConcurrentBatches ?? DEFAULT_MAX_CONCURRENT_BATCHES);
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
    const embeddings = await this.provider.embedBatch(texts);

    return clusters.map((cluster, index) => ({
      clusterId: cluster.id,
      text: texts[index] ?? "",
      embedding: embeddings[index]!,
      generatedAt: Date.now()
    }));
  }
}
