import { hybridScore, type HybridScoreResult } from "../scoring/hybrid.js";
import type { UnifiedSignal } from "../signals/types.js";
import type { EmbeddingProvider, EmbeddingResult } from "./types.js";
import { ClusterEmbeddingIndex, type ClusterEmbeddingMatch } from "./cluster-embedding-index.js";
import { signalToEmbeddingText, type EmbeddingTextOptions } from "./text.js";

export interface SemanticRetrievalOptions {
  limit?: number;
  minSimilarity?: number;
  text?: EmbeddingTextOptions;
}

export interface SemanticRetrievalResult {
  queryText: string;
  queryEmbedding: EmbeddingResult;
  matches: ClusterEmbeddingMatch[];
  scores: HybridScoreResult[];
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = -1;

function boundLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_LIMIT), 1000));
}

function boundSimilarity(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_SIMILARITY;
  return Math.max(-1, Math.min(value ?? DEFAULT_MIN_SIMILARITY, 1));
}

export class SemanticRetrievalService {
  private readonly provider: EmbeddingProvider;
  private readonly index: ClusterEmbeddingIndex;

  public constructor(provider: EmbeddingProvider, index: ClusterEmbeddingIndex) {
    this.provider = provider;
    this.index = index;
  }

  public async retrieveForSignal(
    signal: UnifiedSignal,
    options: SemanticRetrievalOptions = {}
  ): Promise<SemanticRetrievalResult> {
    const limit = boundLimit(options.limit);
    const minSimilarity = boundSimilarity(options.minSimilarity);
    const queryText = signalToEmbeddingText(signal, options.text);
    const queryEmbedding = await this.provider.embedOne(queryText);
    const matches = this.index
      .search(queryEmbedding.vector, limit)
      .filter((match) => match.similarity >= minSimilarity);

    const embeddingSimilarity = new Map<string, number>();

    for (const match of matches) {
      embeddingSimilarity.set(match.clusterId, match.similarity);
    }

    return {
      queryText,
      queryEmbedding,
      matches,
      scores: hybridScore({ embeddingSimilarity })
    };
  }
}
