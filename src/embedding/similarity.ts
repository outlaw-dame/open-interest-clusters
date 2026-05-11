import type { EmbeddingVector } from "./types.js";

function validateVector(values: readonly number[]): void {
  if (values.length === 0) {
    throw new Error("Embedding vector must not be empty");
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains non-finite values");
    }
  }
}

export function cosineSimilarity(left: EmbeddingVector, right: EmbeddingVector): number {
  validateVector(left.values);
  validateVector(right.values);

  if (left.values.length !== right.values.length) {
    throw new Error("Embedding vectors must have identical dimensions");
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.values.length; index += 1) {
    const leftValue = left.values[index] ?? 0;
    const rightValue = right.values[index] ?? 0;

    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
