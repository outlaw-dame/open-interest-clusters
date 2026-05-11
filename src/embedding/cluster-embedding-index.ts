import { cosineSimilarity } from "./similarity.js";
import type { ClusterEmbedding, EmbeddingVector } from "./types.js";

export interface ClusterEmbeddingMatch {
  clusterId: string;
  similarity: number;
}

export class ClusterEmbeddingIndex {
  private readonly vectors = new Map<string, EmbeddingVector>();

  constructor(initial?: readonly ClusterEmbedding[]) {
    if (!initial) return;

    for (const embedding of initial) {
      this.set(embedding.clusterId, embedding.vector);
    }
  }

  set(clusterId: string, vector: EmbeddingVector): void {
    this.vectors.set(clusterId, {
      values: [...vector.values]
    });
  }

  delete(clusterId: string): boolean {
    return this.vectors.delete(clusterId);
  }

  has(clusterId: string): boolean {
    return this.vectors.has(clusterId);
  }

  get(clusterId: string): EmbeddingVector | undefined {
    const vector = this.vectors.get(clusterId);
    if (!vector) return undefined;

    return {
      values: [...vector.values]
    };
  }

  toEmbeddings(): ClusterEmbedding[] {
    return Array.from(this.vectors.entries(), ([clusterId, vector]) => ({
      clusterId,
      vector: {
        values: [...vector.values]
      }
    }));
  }

  size(): number {
    return this.vectors.size;
  }

  search(query: EmbeddingVector, limit: number = 10): ClusterEmbeddingMatch[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const matches: ClusterEmbeddingMatch[] = [];

    for (const [clusterId, vector] of this.vectors.entries()) {
      matches.push({
        clusterId,
        similarity: cosineSimilarity(query, vector)
      });
    }

    return matches
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, boundedLimit);
  }
}
