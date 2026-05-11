export interface RankedCluster {
  clusterId: string;
  score: number;
  category?: string;
  seenRecently?: boolean;
}

export interface MultiObjectiveWeights {
  relevance: number;
  diversity: number;
  novelty: number;
}

export interface MultiObjectiveRankResult extends RankedCluster {
  adjustedScore: number;
  components: {
    relevance: number;
    diversity: number;
    novelty: number;
  };
}

const DEFAULT_WEIGHTS: MultiObjectiveWeights = {
  relevance: 1,
  diversity: 0.2,
  novelty: 0.15
};

export function rerankMultiObjective(
  clusters: readonly RankedCluster[],
  weights: Partial<MultiObjectiveWeights> = {}
): MultiObjectiveRankResult[] {
  const resolvedWeights: MultiObjectiveWeights = {
    relevance: Math.max(0, weights.relevance ?? DEFAULT_WEIGHTS.relevance),
    diversity: Math.max(0, weights.diversity ?? DEFAULT_WEIGHTS.diversity),
    novelty: Math.max(0, weights.novelty ?? DEFAULT_WEIGHTS.novelty)
  };

  const categoryCounts = new Map<string, number>();
  const output: MultiObjectiveRankResult[] = [];

  const sorted = [...clusters].sort((a, b) => b.score - a.score);

  for (const cluster of sorted) {
    const relevance = cluster.score * resolvedWeights.relevance;

    const categoryCount = cluster.category
      ? (categoryCounts.get(cluster.category) ?? 0)
      : 0;

    const diversity = categoryCount > 0
      ? -(categoryCount * resolvedWeights.diversity)
      : resolvedWeights.diversity;

    const novelty = cluster.seenRecently
      ? 0
      : resolvedWeights.novelty;

    const adjustedScore = relevance + diversity + novelty;

    output.push({
      ...cluster,
      adjustedScore,
      components: {
        relevance,
        diversity,
        novelty
      }
    });

    if (cluster.category) {
      categoryCounts.set(cluster.category, categoryCount + 1);
    }
  }

  return output.sort((a, b) => b.adjustedScore - a.adjustedScore);
}
