import type { RecommendationExplanation } from "../local-preferences/explanations.js";
import type { ServedCandidate } from "../serving/candidates.js";
import type { RecommendationCandidate, RecommendationCandidateKind } from "./candidate-domain.js";
import type { RecommendationCandidateEligibilityResult } from "./candidate-eligibility.js";
import type { RecommendationCandidateSourceAdapter } from "./candidate-source-adapter.js";
import {
  generateRecommendationColdStartCandidates,
  type RecommendationColdStartGeneratedCandidate,
  type RecommendationColdStartSourceFailure
} from "./cold-start-candidate-generation.js";
import {
  buildColdStartScoringInput,
  type RecommendationColdStartScoringFeatureResolver
} from "./cold-start-scoring-input-builder.js";
import type { RecommendationEngineOrchestrator } from "./engine-orchestrator.js";
import {
  createRecommendationExecutionOrchestrator,
  type RecommendationExecutionCandidateMetadata,
  type RecommendationExecutionRerankOptions
} from "./execution-orchestrator.js";
import { createRecommendationEmbeddingSourceFingerprint } from "./embedding-lifecycle.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export interface RecommendationFirstSessionEligibilityContext {
  candidate: RecommendationColdStartGeneratedCandidate;
  requestId: string;
  signal?: AbortSignal;
}

export type RecommendationFirstSessionEligibilityEvaluator = (
  context: RecommendationFirstSessionEligibilityContext
) => RecommendationCandidateEligibilityResult | Promise<RecommendationCandidateEligibilityResult>;

export interface RecommendationFirstSessionRecommendation {
  candidate: RecommendationCandidate;
  score: number;
  rank: number;
  components: ServedCandidate["components"];
  explanation?: RecommendationExplanation;
}

export interface RecommendationFirstSessionRequest {
  subjectId: string;
  requestId: string;
  languages?: readonly string[];
  limit?: number;
  minScore?: number;
  excludeCandidateIds?: readonly string[];
  signal?: AbortSignal;
}

export interface RecommendationFirstSessionResult {
  requestId: string;
  subjectId: string;
  profileUpdatedAt: string;
  profileSignalCount: number;
  discoveredCandidateCount: number;
  eligibleCandidateCount: number;
  eligibilityFailureCount: number;
  sourceFailures: readonly RecommendationColdStartSourceFailure[];
  recommendations: readonly RecommendationFirstSessionRecommendation[];
}

export interface RecommendationFirstSessionOrchestratorOptions {
  engine: Pick<RecommendationEngineOrchestrator, "readProfile">;
  sources: readonly RecommendationCandidateSourceAdapter[];
  candidateKinds: readonly RecommendationCandidateKind[];
  evaluateEligibility: RecommendationFirstSessionEligibilityEvaluator;
  resolveFeatures?: RecommendationColdStartScoringFeatureResolver;
  resolveExplanations?: (
    candidates: Parameters<NonNullable<Parameters<typeof createRecommendationExecutionOrchestrator>[0]["resolveExplanations"]>>[0],
    context: Parameters<NonNullable<Parameters<typeof createRecommendationExecutionOrchestrator>[0]["resolveExplanations"]>>[1]
  ) => ReturnType<NonNullable<Parameters<typeof createRecommendationExecutionOrchestrator>[0]["resolveExplanations"]>>;
  rerank?: RecommendationExecutionRerankOptions;
  perSourceLimit?: number;
  maxCandidates?: number;
  sourceConcurrency?: number;
  eligibilityConcurrency?: number;
  featureConcurrency?: number;
  maxScoredCandidates?: number;
}

export interface RecommendationFirstSessionOrchestrator {
  execute(request: RecommendationFirstSessionRequest): Promise<RecommendationFirstSessionResult>;
}

const MAX_IDENTIFIER_LENGTH = 512;
const DEFAULT_ELIGIBILITY_CONCURRENCY = 8;
const MAX_ELIGIBILITY_CONCURRENCY = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, message: string): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH || hasUnsafeControlCharacter(value)
  ) throw new TypeError(message);
  return value;
}

function positiveConcurrency(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_ELIGIBILITY_CONCURRENCY) {
    throw new TypeError("Invalid first-session eligibility concurrency.");
  }
  return value;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function normalizeRequest(request: RecommendationFirstSessionRequest): RecommendationFirstSessionRequest {
  if (!isRecord(request)) throw new TypeError("Invalid first-session recommendation request.");
  const normalized: RecommendationFirstSessionRequest = {
    subjectId: boundedString(request.subjectId, "Invalid first-session subject ID."),
    requestId: boundedString(request.requestId, "Invalid first-session request ID.")
  };
  if (request.languages !== undefined) normalized.languages = request.languages;
  if (request.limit !== undefined) normalized.limit = request.limit;
  if (request.minScore !== undefined) normalized.minScore = request.minScore;
  if (request.excludeCandidateIds !== undefined) normalized.excludeCandidateIds = request.excludeCandidateIds;
  if (request.signal !== undefined) normalized.signal = request.signal;
  return Object.freeze(normalized);
}

async function evaluateCandidates(
  candidates: readonly RecommendationColdStartGeneratedCandidate[],
  requestId: string,
  evaluateEligibility: RecommendationFirstSessionEligibilityEvaluator,
  concurrency: number,
  signal?: AbortSignal
): Promise<{ results: RecommendationCandidateEligibilityResult[]; failureCount: number }> {
  const results = new Array<RecommendationCandidateEligibilityResult | undefined>(candidates.length);
  let nextIndex = 0;
  let failureCount = 0;
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (true) {
      assertNotAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      if (candidate === undefined) return;
      try {
        const result = await evaluateEligibility({
          candidate,
          requestId,
          ...(signal === undefined ? {} : { signal })
        });
        assertNotAborted(signal);
        if (result.candidate.candidateId !== candidate.candidate.candidateId) {
          throw new TypeError("First-session eligibility result references a different candidate.");
        }
        results[index] = result;
      } catch (error) {
        assertNotAborted(signal);
        failureCount += 1;
      }
    }
  });
  await Promise.all(workers);
  return { results: results.filter((value): value is RecommendationCandidateEligibilityResult => value !== undefined), failureCount };
}

export function createRecommendationFirstSessionOrchestrator(
  options: RecommendationFirstSessionOrchestratorOptions
): RecommendationFirstSessionOrchestrator {
  if (
    !isRecord(options) || !isRecord(options.engine) || typeof options.engine.readProfile !== "function" ||
    !Array.isArray(options.sources) || !Array.isArray(options.candidateKinds) ||
    typeof options.evaluateEligibility !== "function" ||
    (options.resolveFeatures !== undefined && typeof options.resolveFeatures !== "function") ||
    (options.resolveExplanations !== undefined && typeof options.resolveExplanations !== "function")
  ) throw new TypeError("Invalid first-session recommendation orchestrator options.");

  const eligibilityConcurrency = positiveConcurrency(options.eligibilityConcurrency, DEFAULT_ELIGIBILITY_CONCURRENCY);

  return Object.freeze({
    async execute(rawRequest: RecommendationFirstSessionRequest): Promise<RecommendationFirstSessionResult> {
      const request = normalizeRequest(rawRequest);
      assertNotAborted(request.signal);
      const profile = await options.engine.readProfile(request.subjectId);
      assertNotAborted(request.signal);

      const generated = await generateRecommendationColdStartCandidates({
        requestId: request.requestId,
        profile,
        sources: options.sources,
        candidateKinds: options.candidateKinds,
        ...(request.languages === undefined ? {} : { languages: request.languages }),
        ...(options.perSourceLimit === undefined ? {} : { perSourceLimit: options.perSourceLimit }),
        ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
        ...(options.sourceConcurrency === undefined ? {} : { concurrency: options.sourceConcurrency }),
        ...(request.signal === undefined ? {} : { signal: request.signal })
      });
      assertNotAborted(request.signal);

      const eligibility = await evaluateCandidates(
        generated.candidates,
        request.requestId,
        options.evaluateEligibility,
        eligibilityConcurrency,
        request.signal
      );
      const eligibilityById = new Map(eligibility.results.map((result) => [result.candidate.candidateId, result]));
      const fingerprint = createRecommendationEmbeddingSourceFingerprint(profile);
      const scoringCandidates = generated.candidates.flatMap((candidate) => {
        const result = eligibilityById.get(candidate.candidate.candidateId);
        if (result === undefined || !result.eligible) return [];
        return [{ generated: candidate, eligibility: result, profileFingerprint: fingerprint }];
      });

      const prepared = await buildColdStartScoringInput(
        {
          profile,
          candidates: scoringCandidates,
          ...(request.signal === undefined ? {} : { signal: request.signal })
        },
        {
          ...(options.resolveFeatures === undefined ? {} : { resolveFeatures: options.resolveFeatures }),
          ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
          ...(options.featureConcurrency === undefined ? {} : { concurrency: options.featureConcurrency })
        }
      );
      assertNotAborted(request.signal);

      const execution = createRecommendationExecutionOrchestrator({
        engine: { readProfile: async () => profile },
        buildScoringInput: async () => prepared.scoringInput,
        ...(options.resolveExplanations === undefined ? {} : { resolveExplanations: options.resolveExplanations }),
        ...(options.rerank === undefined ? {} : { rerank: options.rerank }),
        ...(options.maxScoredCandidates === undefined ? {} : { maxScoredCandidates: options.maxScoredCandidates })
      });
      const executed = await execution.execute({
        subjectId: request.subjectId,
        requestId: request.requestId,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.minScore === undefined ? {} : { minScore: request.minScore }),
        ...(request.excludeCandidateIds === undefined ? {} : { excludeClusterIds: request.excludeCandidateIds })
      });
      assertNotAborted(request.signal);

      const recommendations = executed.response.candidates.map((served) => {
        const candidate = prepared.candidateByScoringId.get(served.clusterId);
        if (candidate === undefined) throw new TypeError("First-session serving returned an unknown candidate identity.");
        const item: RecommendationFirstSessionRecommendation = {
          candidate,
          score: served.score,
          rank: served.rank,
          components: served.components,
          ...(served.explanation === undefined ? {} : { explanation: served.explanation })
        };
        return Object.freeze(item);
      });
      Object.freeze(recommendations);

      return Object.freeze({
        requestId: request.requestId,
        subjectId: request.subjectId,
        profileUpdatedAt: profile.updatedAt,
        profileSignalCount: profile.signalCount,
        discoveredCandidateCount: generated.candidates.length,
        eligibleCandidateCount: scoringCandidates.length,
        eligibilityFailureCount: eligibility.failureCount,
        sourceFailures: generated.failures,
        recommendations
      });
    }
  });
}
