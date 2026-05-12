import type { HybridScoreResult } from "../scoring/hybrid.js";
import type { RecommendationExplanation } from "../local-preferences/explanations.js";

export interface CandidateServingRequest {
  requestId: string;
  candidates: readonly HybridScoreResult[];
  explanations?: ReadonlyMap<string, RecommendationExplanation>;
  limit?: number;
  minScore?: number;
  excludeClusterIds?: readonly string[];
}

export interface ServedCandidate {
  clusterId: string;
  score: number;
  rank: number;
  components: HybridScoreResult["components"];
  explanation?: RecommendationExplanation;
}

export interface CandidateServingResponse {
  requestId: string;
  generatedAt: number;
  candidates: ServedCandidate[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const MAX_CLUSTER_ID_LENGTH = 512;

function isValidClusterId(clusterId: string): boolean {
  return Boolean(clusterId) && clusterId.length <= MAX_CLUSTER_ID_LENGTH && !/[\u0000-\u001F\u007F]/u.test(clusterId);
}

function boundLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_LIMIT), MAX_LIMIT));
}

function normalizeScore(score: number): number | null {
  if (!Number.isFinite(score)) return null;
  return score;
}

export function serveCandidates(request: CandidateServingRequest): CandidateServingResponse {
  if (!request.requestId || /[\u0000-\u001F\u007F]/u.test(request.requestId)) {
    throw new Error("Invalid candidate serving request id");
  }

  const limit = boundLimit(request.limit);
  const minScore = Number.isFinite(request.minScore) ? request.minScore ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const excluded = new Set(request.excludeClusterIds ?? []);
  const seen = new Set<string>();
  const served: ServedCandidate[] = [];

  const sorted = [...request.candidates].sort((left, right) => right.score - left.score || left.clusterId.localeCompare(right.clusterId));

  for (const candidate of sorted) {
    if (served.length >= limit) break;
    if (!isValidClusterId(candidate.clusterId)) continue;
    if (excluded.has(candidate.clusterId)) continue;
    if (seen.has(candidate.clusterId)) continue;

    const score = normalizeScore(candidate.score);
    if (score === null || score < minScore) continue;

    seen.add(candidate.clusterId);
    served.push({
      clusterId: candidate.clusterId,
      score,
      rank: served.length + 1,
      components: candidate.components,
      explanation: request.explanations?.get(candidate.clusterId)
    });
  }

  return {
    requestId: request.requestId,
    generatedAt: Date.now(),
    candidates: served
  };
}
