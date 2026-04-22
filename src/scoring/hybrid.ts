import type { ClusterEntityMatch } from "../entities/types.js";
import type { BanditArmState } from "./bandit.js";
import { scoreBanditState, getBanditObservationCount } from "./bandit.js";

export interface HybridScoreInput {
  deterministic?: Map<string, number>;
  entityMatches?: readonly ClusterEntityMatch[];
  graphBoost?: Map<string, number>;
  banditStates?: Map<string, BanditArmState>;
  totalBanditObservations?: number;
}

export interface HybridScoreResult {
  clusterId: string;
  score: number;
  components: {
    deterministic: number;
    entity: number;
    graph: number;
    bandit: number;
  };
}

export function hybridScore(input: HybridScoreInput): HybridScoreResult[] {
  const scores = new Map<string, HybridScoreResult>();

  if (input.deterministic) {
    for (const [clusterId, score] of input.deterministic.entries()) {
      scores.set(clusterId, {
        clusterId,
        score,
        components: { deterministic: score, entity: 0, graph: 0, bandit: 0 }
      });
    }
  }

  if (input.entityMatches) {
    for (const match of input.entityMatches) {
      const existing = scores.get(match.clusterId) ?? {
        clusterId: match.clusterId,
        score: 0,
        components: { deterministic: 0, entity: 0, graph: 0, bandit: 0 }
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

  if (input.banditStates) {
    let totalObs = input.totalBanditObservations;

    if (!totalObs) {
      totalObs = 0;
      for (const state of input.banditStates.values()) {
        totalObs += getBanditObservationCount(state);
      }
    }

    for (const [clusterId, state] of input.banditStates.entries()) {
      const banditScore = scoreBanditState(state, totalObs);

      const existing = scores.get(clusterId);
      if (!existing) continue;

      existing.components.bandit += banditScore;
      existing.score += banditScore;
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}
