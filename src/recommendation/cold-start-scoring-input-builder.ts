import type { HybridScoreInput } from "../scoring/hybrid.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";

export interface ColdStartScoringCandidate {
  clusterId: string;
  targetKey?: string;
}

export interface ColdStartScoringInputContext {
  profile: RecommendationProfileSnapshot;
  candidates: readonly ColdStartScoringCandidate[];
}

export interface ColdStartScoringInputBuilderOptions {
  resolveDeterministicScore?: (
    candidate: ColdStartScoringCandidate,
    profile: RecommendationProfileSnapshot
  ) => number | undefined;
}

function assertIdentifier(value: string): void {
  if (value.length === 0 || value.length > 512 || /[\x00-\x1F\x7F]/u.test(value)) {
    throw new TypeError("Invalid recommendation candidate identifier.");
  }
}

/**
 * Builds the initial scorer input for a first-session recommendation flow.
 *
 * This intentionally only uses supplied profile and candidate evidence. It does
 * not infer hidden behavioral history or create provider-owned personalization.
 */
export function buildColdStartScoringInput(
  context: ColdStartScoringInputContext,
  options: ColdStartScoringInputBuilderOptions = {}
): HybridScoreInput {
  if (!context || typeof context !== "object") {
    throw new TypeError("Invalid cold start scoring context.");
  }

  const deterministic = new Map<string, number>();
  const profileScores = new Map(
    context.profile.entries.map((entry) => [
      `${entry.target.kind}:${entry.target.key}`,
      entry.score * entry.confidence
    ])
  );

  for (const candidate of context.candidates) {
    assertIdentifier(candidate.clusterId);

    const profileScore = candidate.targetKey
      ? profileScores.get(candidate.targetKey)
      : undefined;

    const resolved = options.resolveDeterministicScore?.(candidate, context.profile);
    const score = resolved ?? profileScore;

    if (score !== undefined && Number.isFinite(score)) {
      deterministic.set(candidate.clusterId, Math.max(-1, Math.min(1, score)));
    }
  }

  return { deterministic };
}
