import { cosineSimilarity } from "../embedding/similarity.js";
import type { EmbeddingVector } from "../embedding/types.js";
import type { LocalPreferenceProfile } from "./types.js";

export interface LocalSemanticProfile {
  schemaVersion: "local-semantic-profile.v1";
  generatedAt: number;
  vector: EmbeddingVector;
}

export interface SemanticCandidate {
  clusterId: string;
  vector: EmbeddingVector;
  score: number;
}

const MAX_VECTOR_DIMENSIONS = 16_384;

function validateVector(vector: EmbeddingVector): void {
  if (vector.values.length === 0 || vector.values.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error("Invalid semantic profile vector dimensions");
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("Semantic profile vector contains non-finite values");
    }
  }
}

export function buildLocalSemanticProfile(
  profile: Readonly<LocalPreferenceProfile>,
  clusterVectors: Readonly<Record<string, EmbeddingVector>>,
  now = Date.now()
): LocalSemanticProfile | null {
  const weightedVectors: number[][] = [];

  for (const interest of profile.interests) {
    const vector = clusterVectors[interest.clusterId];

    if (!vector || interest.weight <= 0) {
      continue;
    }

    validateVector(vector);

    weightedVectors.push(
      vector.values.map((value) => value * interest.weight)
    );
  }

  if (weightedVectors.length === 0) {
    return null;
  }

  const dimensions = weightedVectors[0]?.length ?? 0;
  const merged = new Array<number>(dimensions).fill(0);

  for (const vector of weightedVectors) {
    for (let index = 0; index < dimensions; index += 1) {
      merged[index] = (merged[index] ?? 0) + (vector[index] ?? 0);
    }
  }

  return {
    schemaVersion: "local-semantic-profile.v1",
    generatedAt: Math.max(profile.updatedAt, now),
    vector: {
      values: merged.map((value) => value / weightedVectors.length)
    }
  };
}

export function rerankSemanticCandidates(
  semanticProfile: Readonly<LocalSemanticProfile> | null,
  candidates: readonly SemanticCandidate[]
): SemanticCandidate[] {
  if (!semanticProfile) {
    return [...candidates].sort((left, right) => right.score - left.score);
  }

  validateVector(semanticProfile.vector);

  return candidates
    .map((candidate) => {
      validateVector(candidate.vector);

      return {
        ...candidate,
        score:
          candidate.score +
          cosineSimilarity(semanticProfile.vector, candidate.vector)
      };
    })
    .sort((left, right) => right.score - left.score);
}
