import type { ClusterEntityMatch } from "../entities/types.js";
import type { BanditArmState } from "./bandit.js";
import { scoreBanditState, getBanditObservationCount } from "./bandit.js";

export interface HybridScoreInput {
  deterministic?: Map<string, number>;
  entityMatches?: readonly ClusterEntityMatch[];
  graphBoost?: Map<string, number>;
  banditStates?: Map<string, BanditArmState>;
  contextualBanditStates?: Map<string, BanditArmState>;
  sessionBanditStates?: Map<string, BanditArmState>;
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
    contextual: number;
    session: number;
  };
}

function sumObservations(states?: Map<string, BanditArmState>): number {
  if (!states) return 0;
  let total = 0;
  for (const s of states.values()) total += getBanditObservationCount(s);
  return total;
}

export function hybridScore(input: HybridScoreInput): HybridScoreResult[] {
  const scores = new Map<string, HybridScoreResult>();

  if (input.deterministic) {
    for (const [clusterId, score] of input.deterministic.entries()) {
      scores.set(clusterId, {
        clusterId,
        score,
        components: { deterministic: score, entity: 0, graph: 0, bandit: 0, contextual: 0, session: 0 }
      });
    }
  }

  if (input.entityMatches) {
    for (const match of input.entityMatches) {
      const existing = scores.get(match.clusterId) ?? {
        clusterId: match.clusterId,
        score: 0,
        components: { deterministic: 0, entity: 0, graph: 0, bandit: 0, contextual: 0, session: 0 }
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

  const totalObs = input.totalBanditObservations
    ?? sumObservations(input.banditStates)
    + sumObservations(input.contextualBanditStates)
    + sumObservations(input.sessionBanditStates);

  if (input.banditStates) {
    for (const [clusterId, state] of input.banditStates.entries()) {
      const score = scoreBanditState(state, totalObs);
      const existing = scores.get(clusterId);
      if (!existing) continue;
      existing.components.bandit += score;
      existing.score += score;
    }
  }

  if (input.contextualBanditStates) {
    for (const [clusterId, state] of input.contextualBanditStates.entries()) {
      const score = scoreBanditState(state, totalObs) * 0.7;
      const existing = scores.get(clusterId);
      if (!existing) continue;
      existing.components.contextual += score;
      existing.score += score;
    }
  }

  if (input.sessionBanditStates) {
    for (const [clusterId, state] of input.sessionBanditStates.entries()) {
      const score = scoreBanditState(state, totalObs) * 0.5;
      const existing = scores.get(clusterId);
      if (!existing) continue;
      existing.components.session += score;
      existing.score += score;
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}
