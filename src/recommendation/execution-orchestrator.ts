import type { RecommendationExplanation } from "../local-preferences/explanations.js";
import { hybridScore, type HybridScoreInput, type HybridScoreResult } from "../scoring/hybrid.js";
import { rerankMultiObjective, type MultiObjectiveWeights } from "../scoring/multi-objective.js";
import { serveCandidates, type CandidateServingResponse } from "../serving/candidates.js";
import type { RecommendationEngineOrchestrator } from "./engine-orchestrator.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export interface RecommendationExecutionContext {
  subjectId: string;
  requestId: string;
  profile: RecommendationProfileSnapshot;
}

export type RecommendationScoringInputBuilder = (
  context: RecommendationExecutionContext
) => HybridScoreInput | Promise<HybridScoreInput>;

export interface RecommendationExecutionCandidateMetadata {
  clusterId: string;
  category?: string;
  seenRecently?: boolean;
}

export type RecommendationCandidateMetadataResolver = (
  clusterIds: readonly string[],
  context: RecommendationExecutionContext
) => readonly RecommendationExecutionCandidateMetadata[] |
  Promise<readonly RecommendationExecutionCandidateMetadata[]>;

export type RecommendationExplanationResolver = (
  candidates: readonly HybridScoreResult[],
  context: RecommendationExecutionContext
) => ReadonlyMap<string, RecommendationExplanation> |
  Promise<ReadonlyMap<string, RecommendationExplanation>>;

export interface RecommendationExecutionRerankOptions {
  enabled?: boolean;
  weights?: Partial<MultiObjectiveWeights>;
  resolveMetadata?: RecommendationCandidateMetadataResolver;
}

export interface RecommendationExecutionOrchestratorOptions {
  engine: Pick<RecommendationEngineOrchestrator, "readProfile">;
  buildScoringInput: RecommendationScoringInputBuilder;
  resolveExplanations?: RecommendationExplanationResolver;
  rerank?: RecommendationExecutionRerankOptions;
  maxScoredCandidates?: number;
}

export interface RecommendationExecutionRequest {
  subjectId: string;
  requestId: string;
  limit?: number;
  minScore?: number;
  excludeClusterIds?: readonly string[];
}

export interface RecommendationExecutionResult {
  requestId: string;
  subjectId: string;
  profileUpdatedAt: string;
  profileSignalCount: number;
  scoredCandidateCount: number;
  response: CandidateServingResponse;
}

export interface RecommendationExecutionOrchestrator {
  execute(request: RecommendationExecutionRequest): Promise<RecommendationExecutionResult>;
}

const DEFAULT_MAX_SCORED_CANDIDATES = 10_000;
const MAX_SCORED_CANDIDATES = 100_000;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_CATEGORY_LENGTH = 256;
const MAX_EXPLANATION_LENGTH = 2_048;
const MAX_EXPLANATION_COMPONENTS = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, message: string): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > maximum || hasUnsafeControlCharacter(value)
  ) throw new TypeError(message);
  return value;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    value < 1 || value > MAX_SCORED_CANDIDATES
  ) throw new TypeError("Invalid recommendation execution candidate limit.");
  return value;
}

function finiteNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(message);
  return value;
}

function normalizeRequest(value: RecommendationExecutionRequest): RecommendationExecutionRequest {
  if (!isPlainRecord(value)) throw new TypeError("Invalid recommendation execution request.");
  const request: RecommendationExecutionRequest = {
    subjectId: boundedString(value.subjectId, MAX_IDENTIFIER_LENGTH, "Invalid recommendation execution subject ID."),
    requestId: boundedString(value.requestId, MAX_IDENTIFIER_LENGTH, "Invalid recommendation execution request ID.")
  };
  if (value.limit !== undefined) request.limit = positiveInteger(value.limit, 20);
  if (value.minScore !== undefined) {
    request.minScore = finiteNumber(value.minScore, "Invalid recommendation execution minimum score.");
  }
  if (value.excludeClusterIds !== undefined) {
    if (!Array.isArray(value.excludeClusterIds)) throw new TypeError("Invalid recommendation execution exclusions.");
    const exclusions = value.excludeClusterIds.map((clusterId) =>
      boundedString(clusterId, MAX_IDENTIFIER_LENGTH, "Invalid recommendation execution excluded cluster ID.")
    );
    Object.freeze(exclusions);
    request.excludeClusterIds = exclusions;
  }
  return Object.freeze(request);
}

function normalizeScoredCandidates(
  candidates: readonly HybridScoreResult[],
  maximum: number
): readonly HybridScoreResult[] {
  if (!Array.isArray(candidates)) throw new TypeError("Invalid recommendation execution scoring result.");
  if (candidates.length > maximum) throw new RangeError("Recommendation execution scored candidate limit exceeded.");
  const seen = new Set<string>();
  const normalized: HybridScoreResult[] = [];
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate) || !isPlainRecord(candidate.components)) {
      throw new TypeError("Invalid recommendation execution scored candidate.");
    }
    const clusterId = boundedString(candidate.clusterId, MAX_IDENTIFIER_LENGTH, "Invalid recommendation execution cluster ID.");
    if (seen.has(clusterId)) throw new TypeError("Duplicate recommendation execution cluster ID.");
    seen.add(clusterId);
    const components: HybridScoreResult["components"] = {
      deterministic: finiteNumber(candidate.components.deterministic, "Invalid deterministic score component."),
      entity: finiteNumber(candidate.components.entity, "Invalid entity score component."),
      graph: finiteNumber(candidate.components.graph, "Invalid graph score component."),
      embedding: finiteNumber(candidate.components.embedding, "Invalid embedding score component."),
      bandit: finiteNumber(candidate.components.bandit, "Invalid bandit score component."),
      contextual: finiteNumber(candidate.components.contextual, "Invalid contextual score component."),
      session: finiteNumber(candidate.components.session, "Invalid session score component.")
    };
    Object.freeze(components);
    const item: HybridScoreResult = {
      clusterId,
      score: finiteNumber(candidate.score, "Invalid recommendation execution candidate score."),
      components
    };
    Object.freeze(item);
    normalized.push(item);
  }
  Object.freeze(normalized);
  return normalized;
}

function normalizeMetadata(
  value: readonly RecommendationExecutionCandidateMetadata[],
  expected: ReadonlySet<string>
): ReadonlyMap<string, RecommendationExecutionCandidateMetadata> {
  if (!Array.isArray(value)) throw new TypeError("Invalid recommendation candidate metadata result.");
  const output = new Map<string, RecommendationExecutionCandidateMetadata>();
  for (const item of value) {
    if (!isPlainRecord(item)) throw new TypeError("Invalid recommendation candidate metadata.");
    const clusterId = boundedString(item.clusterId, MAX_IDENTIFIER_LENGTH, "Invalid recommendation metadata cluster ID.");
    if (!expected.has(clusterId)) throw new TypeError("Recommendation metadata references an unknown candidate.");
    if (output.has(clusterId)) throw new TypeError("Duplicate recommendation candidate metadata.");
    const normalized: RecommendationExecutionCandidateMetadata = { clusterId };
    if (item.category !== undefined) {
      normalized.category = boundedString(item.category, MAX_CATEGORY_LENGTH, "Invalid recommendation candidate category.");
    }
    if (item.seenRecently !== undefined) {
      if (typeof item.seenRecently !== "boolean") throw new TypeError("Invalid recommendation seen-recently flag.");
      normalized.seenRecently = item.seenRecently;
    }
    output.set(clusterId, Object.freeze(normalized));
  }
  return output;
}

function normalizeExplanations(
  value: ReadonlyMap<string, RecommendationExplanation>,
  expected: ReadonlySet<string>
): ReadonlyMap<string, RecommendationExplanation> {
  if (value === null || typeof value !== "object" || typeof value.entries !== "function") {
    throw new TypeError("Invalid recommendation explanation result.");
  }
  const output = new Map<string, RecommendationExplanation>();
  for (const [key, explanation] of value.entries()) {
    const clusterId = boundedString(key, MAX_IDENTIFIER_LENGTH, "Invalid recommendation explanation cluster ID.");
    if (!expected.has(clusterId) || !isPlainRecord(explanation) || explanation.clusterId !== clusterId) {
      throw new TypeError("Recommendation explanation is not bound to a scored candidate.");
    }
    const summary = boundedString(explanation.summary, MAX_EXPLANATION_LENGTH, "Invalid recommendation explanation summary.");
    if (!Array.isArray(explanation.components) || explanation.components.length > MAX_EXPLANATION_COMPONENTS) {
      throw new TypeError("Invalid recommendation explanation components.");
    }
    const components: RecommendationExplanation["components"] = explanation.components.map((component) => {
      if (!isPlainRecord(component)) throw new TypeError("Invalid recommendation explanation component.");
      return Object.freeze({
        label: boundedString(component.label, MAX_CATEGORY_LENGTH, "Invalid recommendation explanation component label."),
        contribution: finiteNumber(component.contribution, "Invalid recommendation explanation contribution.")
      });
    });
    Object.freeze(components);
    const normalized: RecommendationExplanation = {
      clusterId,
      summary,
      components,
      confidence: Math.max(0, Math.min(1,
        finiteNumber(explanation.confidence, "Invalid recommendation explanation confidence.")))
    };
    Object.freeze(normalized);
    output.set(clusterId, normalized);
  }
  return output;
}

function freezeResponse(response: CandidateServingResponse): CandidateServingResponse {
  const candidates: CandidateServingResponse["candidates"] = response.candidates.map((candidate) =>
    Object.freeze({ ...candidate })
  );
  Object.freeze(candidates);
  const frozen: CandidateServingResponse = {
    requestId: response.requestId,
    generatedAt: response.generatedAt,
    candidates
  };
  Object.freeze(frozen);
  return frozen;
}

export function createRecommendationExecutionOrchestrator(
  options: RecommendationExecutionOrchestratorOptions
): RecommendationExecutionOrchestrator {
  if (
    !isPlainRecord(options) || !isPlainRecord(options.engine) ||
    typeof options.engine.readProfile !== "function" || typeof options.buildScoringInput !== "function" ||
    (options.resolveExplanations !== undefined && typeof options.resolveExplanations !== "function") ||
    (options.rerank !== undefined && !isPlainRecord(options.rerank))
  ) throw new TypeError("Invalid recommendation execution orchestrator options.");
  if (options.rerank?.resolveMetadata !== undefined && typeof options.rerank.resolveMetadata !== "function") {
    throw new TypeError("Invalid recommendation candidate metadata resolver.");
  }
  const maxCandidates = positiveInteger(options.maxScoredCandidates, DEFAULT_MAX_SCORED_CANDIDATES);
  const rerankEnabled = options.rerank?.enabled === true;

  return Object.freeze({
    async execute(rawRequest: RecommendationExecutionRequest): Promise<RecommendationExecutionResult> {
      const request = normalizeRequest(rawRequest);
      const profile = await options.engine.readProfile(request.subjectId);
      const context: RecommendationExecutionContext = Object.freeze({
        subjectId: request.subjectId,
        requestId: request.requestId,
        profile
      });
      const scoringInput = await options.buildScoringInput(context);
      if (!isPlainRecord(scoringInput)) throw new TypeError("Invalid recommendation execution scoring input.");
      let scored = normalizeScoredCandidates(hybridScore(scoringInput), maxCandidates);
      const scoredCandidateCount = scored.length;
      if (request.excludeClusterIds !== undefined && request.excludeClusterIds.length > 0) {
        const excluded = new Set(request.excludeClusterIds);
        const eligible = scored.filter((candidate) => !excluded.has(candidate.clusterId));
        Object.freeze(eligible);
        scored = eligible;
      }
      const expected = new Set(scored.map((candidate) => candidate.clusterId));

      if (rerankEnabled) {
        const metadata = options.rerank?.resolveMetadata === undefined
          ? new Map<string, RecommendationExecutionCandidateMetadata>()
          : normalizeMetadata(await options.rerank.resolveMetadata([...expected], context), expected);
        const adjusted = rerankMultiObjective(scored.map((candidate) => {
          const item = metadata.get(candidate.clusterId);
          const ranked: { clusterId: string; score: number; category?: string; seenRecently?: boolean } = {
            clusterId: candidate.clusterId,
            score: candidate.score
          };
          if (item?.category !== undefined) ranked.category = item.category;
          if (item?.seenRecently !== undefined) ranked.seenRecently = item.seenRecently;
          return ranked;
        }), options.rerank?.weights);
        const adjustedById = new Map(adjusted.map((item) => [item.clusterId, item.adjustedScore]));
        const reranked: HybridScoreResult[] = scored.map((candidate) => {
          const item: HybridScoreResult = {
            clusterId: candidate.clusterId,
            score: adjustedById.get(candidate.clusterId) ?? candidate.score,
            components: candidate.components
          };
          Object.freeze(item);
          return item;
        });
        Object.freeze(reranked);
        scored = reranked;
      }

      const explanations = options.resolveExplanations === undefined
        ? undefined
        : normalizeExplanations(await options.resolveExplanations(scored, context), expected);
      const servingRequest: Parameters<typeof serveCandidates>[0] = {
        requestId: request.requestId,
        candidates: scored
      };
      if (explanations !== undefined) servingRequest.explanations = explanations;
      if (request.limit !== undefined) servingRequest.limit = request.limit;
      if (request.minScore !== undefined) servingRequest.minScore = request.minScore;
      if (request.excludeClusterIds !== undefined) servingRequest.excludeClusterIds = request.excludeClusterIds;
      const response = freezeResponse(serveCandidates(servingRequest));
      const result: RecommendationExecutionResult = {
        requestId: request.requestId,
        subjectId: request.subjectId,
        profileUpdatedAt: profile.updatedAt,
        profileSignalCount: profile.signalCount,
        scoredCandidateCount,
        response
      };
      return Object.freeze(result);
    }
  });
}
