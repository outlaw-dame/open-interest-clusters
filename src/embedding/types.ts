export interface EmbeddingVector {
  values: readonly number[];
}

export interface EmbeddingResult {
  text: string;
  vector: EmbeddingVector;
}

export interface EmbeddingProvider {
  embedOne(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]>;
}

export interface ClusterEmbedding {
  clusterId: string;
  vector: EmbeddingVector;
}
