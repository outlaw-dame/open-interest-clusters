import { cosineSimilarity } from "../embedding/similarity.js";
import type { EmbeddingVector } from "../embedding/types.js";
import type {
  AnnIndexStats,
  AnnProvider,
  AnnSearchOptions,
  AnnSearchResult
} from "./types.js";

const MAX_VECTOR_DIMENSIONS = 16_384;
const MAX_RESULTS = 1_000;
const MAX_CLUSTER_ID_LENGTH = 512;

function validateClusterId(clusterId: string): void {
  if (!clusterId || clusterId.length > MAX_CLUSTER_ID_LENGTH || /[\u0000-\u001F\u007F]/u.test(clusterId)) {
    throw new Error("Invalid ANN cluster id");
  }
}

function validateVector(vector: EmbeddingVector): void {
  if (vector.values.length === 0 || vector.values.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error("Invalid ANN vector dimensions");
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("ANN vector contains non-finite values");
    }
  }
}

export class InMemoryAnnProvider implements AnnProvider {
  private readonly vectors = new Map<string, EmbeddingVector>();
  private dimensions = 0;

  async upsert(clusterId: string, vector: EmbeddingVector): Promise<void> {
    validateClusterId(clusterId);
    validateVector(vector);

    if (this.dimensions !== 0 && vector.values.length !== this.dimensions) {
      throw new Error("ANN vector dimensions mismatch");
    }

    this.dimensions = vector.values.length;

    this.vectors.set(clusterId, {
      values: [...vector.values]
    });
  }

  async delete(clusterId: string): Promise<boolean> {
    validateClusterId(clusterId);
    const deleted = this.vectors.delete(clusterId);

    if (this.vectors.size === 0) {
      this.dimensions = 0;
    }

    return deleted;
  }

  async search(
    vector: EmbeddingVector,
    options: AnnSearchOptions = {}
  ): Promise<AnnSearchResult[]> {
    validateVector(vector);

    if (this.dimensions !== 0 && vector.values.length !== this.dimensions) {
      throw new Error("ANN query vector dimensions mismatch");
    }

    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), MAX_RESULTS));
    const minSimilarity = Number.isFinite(options.minSimilarity)
      ? Math.max(-1, Math.min(options.minSimilarity ?? -1, 1))
      : -1;

    const results: AnnSearchResult[] = [];

    for (const [clusterId, stored] of this.vectors.entries()) {
      const similarity = cosineSimilarity(vector, stored);

      if (!Number.isFinite(similarity) || similarity < minSimilarity) {
        continue;
      }

      results.push({
        clusterId,
        similarity
      });
    }

    return results
      .sort((left, right) => right.similarity - left.similarity || left.clusterId.localeCompare(right.clusterId))
      .slice(0, limit);
  }

  async stats(): Promise<AnnIndexStats> {
    return {
      size: this.vectors.size,
      dimensions: this.dimensions
    };
  }
}
