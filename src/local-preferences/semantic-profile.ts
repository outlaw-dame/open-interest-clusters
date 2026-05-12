import type { EmbeddingVector } from "../embedding/types.js";

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
