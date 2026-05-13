import type { EmbeddingVector } from "../../embedding/types.js";

const MAX_VECTOR_DIMENSIONS = 16_384;

export function validatePgVectorEmbedding(
  vector: EmbeddingVector,
  expectedDimensions: number
): void {
  if (
    vector.values.length !== expectedDimensions ||
    vector.values.length === 0 ||
    vector.values.length > MAX_VECTOR_DIMENSIONS
  ) {
    throw new Error("Invalid pgvector vector dimensions");
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("pgvector vector contains non-finite values");
    }
  }
}

export function serializePgVectorEmbedding(vector: EmbeddingVector): string {
  return `[${vector.values.join(",")}]`;
}
