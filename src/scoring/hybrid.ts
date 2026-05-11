import type { ClusterEntityMatch } from "../entities/types.js";
import type { BanditArmState } from "./bandit.js";
import { scoreBanditState, getBanditObservationCount } from "./bandit.js";

export interface HybridScoreInput {
  deterministic?: Map<string, number>;
  entityMatches?: readonly ClusterEntityMatch[];
  graphBoost?: Map<string, number>;
  embeddingSimilarity?: Map<string, number>;
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
    embedding: number;
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

function getOrCreate(
  scores: Map<string, HybridScoreResult>,
  clusterId: string
): HybridScoreResult {
  const existing = scores.get(clusterId);
  if (existing) return existing;

  const created: HybridScoreResult = {
    clusterId,
    score: 0,
    components: {
      deterministic: 0,
      entity: 0,
      graph: 0,
      embedding: 0,
      bandit: 0,
      contextual: 0,
      session: 0
    }
  };

  scores.set(clusterId, created);
  return created;
}

export function hybridScore(input: HybridScoreInput): HybridScoreResult[] {
  const scores = new Map<string, HybridScoreResult>();

  if (input.deterministic) {
    for (const [clusterId, score] of input.deterministic.entries()) {
      const existing = getOrCreate(scores, clusterId);
      existing.components.deterministic += score;
      existing.score += score;
    }
  }

  if (input.entityMatches) {
    for (const match of input.entityMatches) {
      const existing = getOrCreate(scores, match.clusterId);

      existing.components.entity += match.score;
      existing.score += match.score;
    }
  }

  if (input.graphBoost) {
    for (const [clusterId, boost] of input.graphBoost.entries()) {
      const existing = getOrCreate(scores, clusterId);
      existing.components.graph += boost;
      existing.score += boost;
    }
  }

  if (input.embeddingSimilarity) {
    for (const [clusterId, similarity] of input.embeddingSimilarity.entries()) {
      const boundedSimilarity = Math.max(-1, Math.min(similarity, 1));
      const weighted = boundedSimilarity * 0.35;

      const existing = getOrCreate(scores, clusterId);
      existing.components.embedding += weighted;
      existing.score += weighted;
    }
  }

  const totalObs = input.totalBanditObservations
    ?? sumObservations(input.banditStates)
    + sumObservations(input.contextualBanditStates)
    + sumObservations(input.sessionBanditStates);

  if (input.banditStates) {
    for (const [clusterId, state] of input.banditStates.entries()) {
      const score = scoreBanditState(state, totalObs);
      const existing = getOrCreate(scores, clusterId);
      existing.components.bandit += score;
      existing.score += score;
    }
  }

  if (input.contextualBanditStates) {
    for (const [clusterId, state] of input.contextualBanditStates.entries()) {
      const score = scoreBanditState(state, totalObs) * 0.7;
      const existing = getOrCreate(scores, clusterId);
      existing.components.contextual += score;
      existing.score += score;
    }
  }

  if (input.sessionBanditStates) {
    for (const [clusterId, state] of input.sessionBanditStates.entries()) {
      const score = scoreBanditState(state, totalObs) * 0.5;
      const existing = getOrCreate(scores, clusterId);
      existing.components.session += score;
      existing.score += score;
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}
