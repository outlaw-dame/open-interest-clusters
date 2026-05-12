import type { EmbeddingVector } from "../embedding/types.js";

export interface AnnSearchResult {
  clusterId: string;
  similarity: number;
}

export interface AnnSearchOptions {
  limit?: number;
  minSimilarity?: number;
}

export interface AnnIndexStats {
  size: number;
  dimensions: number;
}

export interface AnnProvider {
  upsert(clusterId: string, vector: EmbeddingVector): Promise<void>;
  delete(clusterId: string): Promise<boolean>;
  search(
    vector: EmbeddingVector,
    options?: AnnSearchOptions
  ): Promise<AnnSearchResult[]>;
  stats(): Promise<AnnIndexStats>;
}
