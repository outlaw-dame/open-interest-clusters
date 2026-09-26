import type { ClusterEntityMatch } from "../entities/types.js";
import type { HybridScoreInput } from "../scoring/hybrid.js";
import type { RecommendationCandidateEligibilityResult } from "./candidate-eligibility.js";
import type { RecommendationColdStartGeneratedCandidate } from "./cold-start-candidate-generation.js";
import {
  createRecommendationEmbeddingSourceFingerprint,
  type RecommendationEmbeddingSourceFingerprint
} from "./embedding-lifecycle.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";

export interface RecommendationColdStartScoringCandidate {
  generated: RecommendationColdStartGeneratedCandidate;
  eligibility: RecommendationCandidateEligibilityResult;
  profileFingerprint: RecommendationEmbeddingSourceFingerprint;
}

export interface RecommendationColdStartScoringResolverContext {
  candidateId: string;
  candidate: RecommendationColdStartGeneratedCandidate["candidate"];
  match: RecommendationColdStartGeneratedCandidate["match"];
  profileFingerprint: RecommendationEmbeddingSourceFingerprint;
  signal?: AbortSignal;
}

export interface RecommendationColdStartScoringFeatureSet {
  entityMatch?: ClusterEntityMatch;
  graphBoost?: number;
  embeddingSimilarity?: number;
}

export type RecommendationColdStartScoringFeatureResolver = (
  context: RecommendationColdStartScoringResolverContext
) => RecommendationColdStartScoringFeatureSet | Promise<RecommendationColdStartScoringFeatureSet>;

export interface RecommendationColdStartScoringInputContext {
  profile: RecommendationProfileSnapshot;
  candidates: readonly RecommendationColdStartScoringCandidate[];
  signal?: AbortSignal;
}

export interface RecommendationColdStartScoringInputBuilderOptions {
  resolveFeatures?: RecommendationColdStartScoringFeatureResolver;
  maxCandidates?: number;
  concurrency?: number;
}

export interface RecommendationColdStartScoringInputResult {
  scoringInput: HybridScoreInput;
  candidateByScoringId: ReadonlyMap<string, RecommendationColdStartGeneratedCandidate["candidate"]>;
  profileFingerprint: RecommendationEmbeddingSourceFingerprint;
}

const DEFAULT_MAX_CANDIDATES = 500;
const MAX_CANDIDATES = 5_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function positiveSafeInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  message: string
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function finiteNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(message);
  }
  return value;
}

function sameFingerprint(
  left: RecommendationEmbeddingSourceFingerprint,
  right: RecommendationEmbeddingSourceFingerprint
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.profileUpdatedAt === right.profileUpdatedAt &&
    left.profileSignalCount === right.profileSignalCount &&
    left.profileDigest === right.profileDigest;
}

function deterministicScore(candidate: RecommendationColdStartGeneratedCandidate): number {
  const base = candidate.match.profileAffinityWeight;
  const languageMultiplier = candidate.match.languageCompatibility === "incompatible" ? 0 :
    candidate.match.languageCompatibility === "compatible" ? 1 :
    0.85;
  const normalized = Math.tanh(base) * languageMultiplier;
  return Math.max(0, Math.min(1, normalized));
}

function normalizeEntityMatch(
  value: ClusterEntityMatch | undefined,
  expectedCandidateId: string
): ClusterEntityMatch | undefined {
  if (value === undefined) return undefined;
  if (value.clusterId !== expectedCandidateId) {
    throw new TypeError("Cold-start entity match references an unknown candidate.");
  }
  const score = finiteNumber(value.score, "Invalid cold-start entity score.");
  if (!Array.isArray(value.matchedEntityIds) || !Array.isArray(value.relationHits)) {
    throw new TypeError("Invalid cold-start entity match.");
  }
  return {
    clusterId: expectedCandidateId,
    score,
    matchedEntityIds: [...value.matchedEntityIds],
    relationHits: [...value.relationHits]
  };
}

function normalizeFeatureSet(
  value: RecommendationColdStartScoringFeatureSet,
  expectedCandidateId: string
): RecommendationColdStartScoringFeatureSet {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid cold-start scoring feature set.");
  }
  const normalized: RecommendationColdStartScoringFeatureSet = {};
  const entityMatch = normalizeEntityMatch(value.entityMatch, expectedCandidateId);
  if (entityMatch !== undefined) normalized.entityMatch = entityMatch;
  if (value.graphBoost !== undefined) {
    normalized.graphBoost = finiteNumber(value.graphBoost, "Invalid cold-start graph boost.");
  }
  if (value.embeddingSimilarity !== undefined) {
    const similarity = finiteNumber(value.embeddingSimilarity, "Invalid cold-start embedding similarity.");
    if (similarity < -1 || similarity > 1) {
      throw new TypeError("Invalid cold-start embedding similarity.");
    }
    normalized.embeddingSimilarity = similarity;
  }
  return normalized;
}

export async function buildColdStartScoringInput(
  context: RecommendationColdStartScoringInputContext,
  options: RecommendationColdStartScoringInputBuilderOptions = {}
): Promise<RecommendationColdStartScoringInputResult> {
  if (context === null || typeof context !== "object" || !Array.isArray(context.candidates)) {
    throw new TypeError("Invalid cold-start scoring context.");
  }
  if (options === null || typeof options !== "object") {
    throw new TypeError("Invalid cold-start scoring options.");
  }

  const maxCandidates = positiveSafeInteger(
    options.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    MAX_CANDIDATES,
    "Invalid cold-start scoring candidate limit."
  );
  const concurrency = positiveSafeInteger(
    options.concurrency,
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
    "Invalid cold-start scoring concurrency."
  );

  if (context.candidates.length > maxCandidates) {
    throw new RangeError("Cold-start scoring candidate limit exceeded.");
  }

  assertNotAborted(context.signal);
  const profileFingerprint = createRecommendationEmbeddingSourceFingerprint(context.profile);
  const deterministic = new Map<string, number>();
  const entityMatches: ClusterEntityMatch[] = [];
  const graphBoost = new Map<string, number>();
  const embeddingSimilarity = new Map<string, number>();
  const candidateByScoringId = new Map<string, RecommendationColdStartGeneratedCandidate["candidate"]>();
  const seen = new Set<string>();

  for (const item of context.candidates) {
    if (item === null || typeof item !== "object") {
      throw new TypeError("Invalid cold-start scoring candidate.");
    }
    const candidate = item.generated?.candidate;
    const match = item.generated?.match;
    const eligibility = item.eligibility;
    if (candidate === undefined || match === undefined || eligibility === undefined) {
      throw new TypeError("Invalid cold-start scoring candidate.");
    }
    if (!eligibility.eligible || eligibility.candidate.candidateId !== candidate.candidateId) {
      throw new TypeError("Cold-start scoring requires an eligible candidate bound to the same identity.");
    }
    if (!sameFingerprint(item.profileFingerprint, profileFingerprint)) {
      throw new TypeError("Cold-start scoring candidate profile binding is stale.");
    }
    if (seen.has(candidate.candidateId)) {
      throw new TypeError("Duplicate cold-start scoring candidate identity.");
    }
    seen.add(candidate.candidateId);
    candidateByScoringId.set(candidate.candidateId, candidate);
    deterministic.set(candidate.candidateId, deterministicScore(item.generated));
  }

  if (options.resolveFeatures !== undefined) {
    if (typeof options.resolveFeatures !== "function") {
      throw new TypeError("Invalid cold-start scoring feature resolver.");
    }
    const ordered = [...context.candidates].sort((left, right) =>
      left.generated.candidate.candidateId.localeCompare(right.generated.candidate.candidateId)
    );
    const resolved = new Array<RecommendationColdStartScoringFeatureSet | undefined>(ordered.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, ordered.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        assertNotAborted(context.signal);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= ordered.length) return;
        const item = ordered[index];
        if (item === undefined) return;
        const candidateId = item.generated.candidate.candidateId;
        const raw = await options.resolveFeatures!({
          candidateId,
          candidate: item.generated.candidate,
          match: item.generated.match,
          profileFingerprint,
          ...(context.signal === undefined ? {} : { signal: context.signal })
        });
        assertNotAborted(context.signal);
        resolved[index] = normalizeFeatureSet(raw, candidateId);
      }
    });
    await Promise.all(workers);

    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      const features = resolved[index];
      if (item === undefined || features === undefined) continue;
      const candidateId = item.generated.candidate.candidateId;
      if (features.entityMatch !== undefined) entityMatches.push(features.entityMatch);
      if (features.graphBoost !== undefined) graphBoost.set(candidateId, features.graphBoost);
      if (features.embeddingSimilarity !== undefined) {
        embeddingSimilarity.set(candidateId, features.embeddingSimilarity);
      }
    }
  }

  const scoringInput: HybridScoreInput = {
    deterministic,
    ...(entityMatches.length === 0 ? {} : { entityMatches }),
    ...(graphBoost.size === 0 ? {} : { graphBoost }),
    ...(embeddingSimilarity.size === 0 ? {} : { embeddingSimilarity })
  };

  return Object.freeze({
    scoringInput,
    candidateByScoringId,
    profileFingerprint
  });
}
