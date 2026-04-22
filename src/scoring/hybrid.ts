import type { ClusterEntityMatch } from "../entities/types.js";

export interface HybridScoreInput {
  deterministic?: Map<string, number>;
  entityMatches?: readonly ClusterEntityMatch[];
  graphBoost?: Map<string, number>;
}

export interface HybridScoreResult {
  clusterId: string;
  score: number;
  components: {
    deterministic: number;
    entity: number;
    graph: number;
  };
}

export function hybridScore(input: HybridScoreInput): HybridScoreResult[] {
  const scores = new Map<string, HybridScoreResult>();

  if (input.deterministic) {
    for (const [clusterId, score] of input.deterministic.entries()) {
      scores.set(clusterId, {
        clusterId,
        score,
        components: { deterministic: score, entity: 0, graph: 0 }
      });
    }
  }

  if (input.entityMatches) {
    for (const match of input.entityMatches) {
      const existing = scores.get(match.clusterId) ?? {
        clusterId: match.clusterId,
        score: 0,
        components: { deterministic: 0, entity: 0, graph: 0 }
      };

      existing.components.entity += match.score;
      existing.score += match.score;

      scores.set(match.clusterId, existing);
    }
  }

  if (input.graphBoost) {
    for (const [clusterId, boost] of input.graphBoost.entries()) {
      const existing = scores.get(clusterId);
      if (!existing) continue;

      existing.components.graph += boost;
      existing.score += boost;
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}
