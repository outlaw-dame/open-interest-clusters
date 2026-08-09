import { normalizeHashtag } from "../normalization/hashtags.js";
import {
  evaluateRecommendationAccountEligibility,
  type RecommendationAccountEligibilityResult,
  type RecommendationAccountProfile,
  type RecommendationAccountProfileResolver
} from "./account-recommendation-eligibility.js";
import type { RecommendationCandidate, RecommendationCandidateKind } from "./candidate-domain.js";
import type { RecommendationColdStartGeneratedCandidate } from "./cold-start-candidate-generation.js";
import {
  evaluateRecommendationStorageAuthority,
  isRecommendationProcessingBoundary,
  isRecommendationStorageAuthority,
  type RecommendationProcessingBoundary,
  type RecommendationStorageAuthority
} from "./storage-authority.js";

export const RECOMMENDATION_CANDIDATE_ELIGIBILITY_REASONS = [
  "eligible",
  "candidate_unavailable",
  "provider_policy_denied",
  "viewer_safety_denied",
  "viewer_safety_incomplete",
  "viewer_safety_placement_denied",
  "account_inactive",
  "account_deactivated",
  "account_suspended",
  "account_deleted",
  "account_unresolved",
  "account_move_loop",
  "account_move_limit",
  "post_not_public",
  "post_identity_unbound",
  "identity_unverified",
  "resource_unresolvable",
  "starter_pack_not_current",
  "starter_pack_members_unbounded",
  "labeler_identity_unverified",
  "community_unavailable",
  "hashtag_not_public",
  "hashtag_invalid",
  "topic_not_canonical",
  "topic_metadata_unsafe",
  "instance_not_current",
  "instance_unhealthy",
  "instance_registration_closed"
] as const;

export type RecommendationCandidateEligibilityReason =
  typeof RECOMMENDATION_CANDIDATE_ELIGIBILITY_REASONS[number];

export interface RecommendationCandidateViewerSafetyDecision {
  eligible: boolean;
  evidenceComplete: boolean;
}

export interface RecommendationCandidateViewerSafetyEvaluator {
  authority: RecommendationStorageAuthority;
  processingBoundary: RecommendationProcessingBoundary;
  evaluate(
    candidate: RecommendationCandidate,
    signal?: AbortSignal
  ): RecommendationCandidateViewerSafetyDecision | Promise<RecommendationCandidateViewerSafetyDecision>;
}

interface RecommendationCandidateEligibilityEvidenceBase {
  kind: RecommendationCandidateKind;
  providerPolicyAllowsRecommendation: boolean;
}

export interface RecommendationAccountCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "account";
  resolver: RecommendationAccountProfileResolver;
  evaluatedAt?: string;
  inactivityDays?: number;
}

export interface RecommendationPostCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "post";
  explicitlyPublic: boolean;
  identityBound: boolean;
}

export interface RecommendationResolvableCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "feed" | "list";
  resolvable: boolean;
}

export interface RecommendationStarterPackCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "starter_pack";
  resolvable: boolean;
  current: boolean;
  memberCount: number;
  maximumMemberCount?: number;
}

export interface RecommendationLabelerCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "labeler";
  didOrIdentityVerified: boolean;
}

export interface RecommendationCommunityCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "community";
  exists: boolean;
}

export interface RecommendationHashtagCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "hashtag";
  publicTopic: boolean;
}

export interface RecommendationTopicCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "topic";
  canonicalCatalogIdentity: boolean;
  policySafeMetadata: boolean;
}

export interface RecommendationInstanceCandidateEligibilityEvidence
  extends RecommendationCandidateEligibilityEvidenceBase {
  kind: "instance";
  current: boolean;
  healthy: boolean;
  purpose: "discovery" | "signup";
  registrationOpen?: boolean;
}

export type RecommendationCandidateEligibilityEvidence =
  | RecommendationAccountCandidateEligibilityEvidence
  | RecommendationPostCandidateEligibilityEvidence
  | RecommendationResolvableCandidateEligibilityEvidence
  | RecommendationStarterPackCandidateEligibilityEvidence
  | RecommendationLabelerCandidateEligibilityEvidence
  | RecommendationCommunityCandidateEligibilityEvidence
  | RecommendationHashtagCandidateEligibilityEvidence
  | RecommendationTopicCandidateEligibilityEvidence
  | RecommendationInstanceCandidateEligibilityEvidence;

export interface RecommendationResolvedAccountBinding {
  id: string;
  uri: string;
  moveChain: readonly string[];
}

export interface RecommendationCandidateEligibilityResult {
  eligible: boolean;
  reason: RecommendationCandidateEligibilityReason;
  candidateId: string;
  kind: RecommendationCandidateKind;
  resolvedAccount?: RecommendationResolvedAccountBinding;
  requiresExplicitSubscription: boolean;
}

export interface RecommendationEligibleColdStartCandidate {
  candidate: RecommendationCandidate;
  match: RecommendationColdStartGeneratedCandidate["match"];
  eligibility: RecommendationCandidateEligibilityResult;
}

export interface RecommendationCandidateEligibilityBatchFailure {
  candidateId: string;
  reason: "evidence_resolution_failed" | "evaluation_failed";
}

export interface RecommendationCandidateEligibilityBatchResult {
  eligible: readonly RecommendationEligibleColdStartCandidate[];
  rejected: readonly RecommendationCandidateEligibilityResult[];
  failures: readonly RecommendationCandidateEligibilityBatchFailure[];
}

const MAX_STARTER_PACK_MEMBERS = 500;
const MAX_BATCH_CANDIDATES = 5_000;
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strongVerification(candidate: RecommendationCandidate): boolean {
  return candidate.verification.state === "authority_verified" || candidate.verification.state === "canonical";
}

function assertedVerification(candidate: RecommendationCandidate): boolean {
  return candidate.verification.state !== "unverified_hint";
}

function result(
  candidate: RecommendationCandidate,
  reason: RecommendationCandidateEligibilityReason,
  options: {
    resolvedAccount?: RecommendationResolvedAccountBinding;
    requiresExplicitSubscription?: boolean;
  } = {}
): RecommendationCandidateEligibilityResult {
  return Object.freeze({
    eligible: reason === "eligible",
    reason,
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    ...(options.resolvedAccount === undefined ? {} : { resolvedAccount: options.resolvedAccount }),
    requiresExplicitSubscription: options.requiresExplicitSubscription ?? false
  });
}

function accountReason(
  account: RecommendationAccountEligibilityResult
): RecommendationCandidateEligibilityReason {
  switch (account.reason) {
    case "eligible": return "eligible";
    case "inactive": return "account_inactive";
    case "deactivated": return "account_deactivated";
    case "suspended": return "account_suspended";
    case "deleted": return "account_deleted";
    case "unresolved": return "account_unresolved";
    case "move_loop": return "account_move_loop";
    case "move_limit": return "account_move_limit";
  }
}

function resolvedAccountBinding(
  account: RecommendationAccountEligibilityResult
): RecommendationResolvedAccountBinding | undefined {
  const resolved = account.resolvedAccount;
  if (resolved === undefined) return undefined;
  return Object.freeze({
    id: resolved.id,
    uri: resolved.uri,
    moveChain: Object.freeze([...account.moveChain])
  });
}

function validateViewerSafetyEvaluator(
  evaluator: RecommendationCandidateViewerSafetyEvaluator | undefined
): void {
  if (evaluator === undefined) return;
  if (
    !isRecord(evaluator) ||
    !isRecommendationStorageAuthority(evaluator.authority) ||
    !isRecommendationProcessingBoundary(evaluator.processingBoundary) ||
    typeof evaluator.evaluate !== "function"
  ) {
    throw new TypeError("Invalid recommendation candidate viewer-safety evaluator.");
  }
}

async function applyViewerSafety(
  candidate: RecommendationCandidate,
  evaluator: RecommendationCandidateViewerSafetyEvaluator | undefined,
  signal: AbortSignal | undefined
): Promise<RecommendationCandidateEligibilityReason | undefined> {
  if (evaluator === undefined) return undefined;
  const placement = evaluateRecommendationStorageAuthority({
    authority: evaluator.authority,
    processingBoundary: evaluator.processingBoundary,
    subjectLevel: true
  });
  if (placement.decision !== "allow") return "viewer_safety_placement_denied";
  const decision = await evaluator.evaluate(candidate, signal);
  if (!isRecord(decision) || typeof decision.eligible !== "boolean" || typeof decision.evidenceComplete !== "boolean") {
    throw new TypeError("Invalid recommendation candidate viewer-safety decision.");
  }
  if (!decision.evidenceComplete) return "viewer_safety_incomplete";
  if (!decision.eligible) return "viewer_safety_denied";
  return undefined;
}

function validateEvidence(
  candidate: RecommendationCandidate,
  evidence: RecommendationCandidateEligibilityEvidence
): void {
  if (
    !isRecord(evidence) ||
    evidence.kind !== candidate.kind ||
    typeof evidence.providerPolicyAllowsRecommendation !== "boolean"
  ) {
    throw new TypeError("Invalid recommendation candidate eligibility evidence.");
  }
}

function requireAvailable(candidate: RecommendationCandidate): RecommendationCandidateEligibilityReason | undefined {
  return candidate.availability === "available" ? undefined : "candidate_unavailable";
}

function validateMemberCount(evidence: RecommendationStarterPackCandidateEligibilityEvidence): number {
  const maximum = evidence.maximumMemberCount ?? MAX_STARTER_PACK_MEMBERS;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10_000) {
    throw new TypeError("Invalid recommendation starter-pack member bound.");
  }
  if (!Number.isSafeInteger(evidence.memberCount) || evidence.memberCount < 0 || evidence.memberCount > 100_000) {
    throw new TypeError("Invalid recommendation starter-pack member count.");
  }
  return maximum;
}

function normalizedHashtagCandidate(candidate: RecommendationCandidate): boolean {
  const native = normalizeHashtag(candidate.nativeId);
  if (native.length === 0 || native.length > 128) return false;
  return candidate.nativeId === native || candidate.nativeId === `#${native}`;
}

async function evaluateTypeSpecificEligibility(
  candidate: RecommendationCandidate,
  evidence: RecommendationCandidateEligibilityEvidence,
  signal: AbortSignal | undefined
): Promise<RecommendationCandidateEligibilityResult> {
  switch (evidence.kind) {
    case "account": {
      if (candidate.availability === "unavailable") return result(candidate, "candidate_unavailable");
      const account = await evaluateRecommendationAccountEligibility({
        reference: candidate.uri ?? candidate.nativeId,
        resolver: evidence.resolver,
        ...(evidence.evaluatedAt === undefined ? {} : { evaluatedAt: evidence.evaluatedAt }),
        ...(evidence.inactivityDays === undefined ? {} : { inactivityDays: evidence.inactivityDays }),
        ...(signal === undefined ? {} : { signal })
      });
      return result(candidate, accountReason(account), {
        ...(resolvedAccountBinding(account) === undefined ? {} : { resolvedAccount: resolvedAccountBinding(account) })
      });
    }
    case "post": {
      const unavailable = requireAvailable(candidate);
      if (unavailable !== undefined) return result(candidate, unavailable);
      if (!evidence.explicitlyPublic) return result(candidate, "post_not_public");
      if (!evidence.identityBound) return result(candidate, "post_identity_unbound");
      if (!assertedVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
    case "feed":
    case "list": {
      const unavailable = requireAvailable(candidate);
      if (unavailable !== undefined) return result(candidate, unavailable);
      if (!evidence.resolvable) return result(candidate, "resource_unresolvable");
      if (!strongVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
    case "starter_pack": {
      const unavailable = requireAvailable(candidate);
      if (unavailable !== undefined) return result(candidate, unavailable);
      if (!evidence.resolvable) return result(candidate, "resource_unresolvable");
      if (!evidence.current) return result(candidate, "starter_pack_not_current");
      const maximum = validateMemberCount(evidence);
      if (evidence.memberCount > maximum) return result(candidate, "starter_pack_members_unbounded");
      if (!strongVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
    case "labeler": {
      const unavailable = requireAvailable(candidate);
      if (unavailable !== undefined) return result(candidate, unavailable, { requiresExplicitSubscription: true });
      if (!evidence.didOrIdentityVerified || !strongVerification(candidate)) {
        return result(candidate, "labeler_identity_unverified", { requiresExplicitSubscription: true });
      }
      return result(candidate, "eligible", { requiresExplicitSubscription: true });
    }
    case "community": {
      const unavailable = requireAvailable(candidate);
      if (unavailable !== undefined) return result(candidate, unavailable);
      if (!evidence.exists) return result(candidate, "community_unavailable");
      if (!assertedVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
    case "hashtag": {
      if (!evidence.publicTopic) return result(candidate, "hashtag_not_public");
      if (!normalizedHashtagCandidate(candidate)) return result(candidate, "hashtag_invalid");
      if (!assertedVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
    case "topic": {
      if (!evidence.canonicalCatalogIdentity || candidate.verification.state !== "canonical") {
        return result(candidate, "topic_not_canonical");
      }
      if (!evidence.policySafeMetadata) return result(candidate, "topic_metadata_unsafe");
      return result(candidate, "eligible");
    }
    case "instance": {
      if (!evidence.current) return result(candidate, "instance_not_current");
      if (!evidence.healthy) return result(candidate, "instance_unhealthy");
      if (evidence.purpose === "signup" && evidence.registrationOpen !== true) {
        return result(candidate, "instance_registration_closed");
      }
      if (!assertedVerification(candidate)) return result(candidate, "identity_unverified");
      return result(candidate, "eligible");
    }
  }
}

export async function evaluateRecommendationCandidateEligibility(input: {
  candidate: RecommendationCandidate;
  evidence: RecommendationCandidateEligibilityEvidence;
  viewerSafety?: RecommendationCandidateViewerSafetyEvaluator;
  signal?: AbortSignal;
}): Promise<RecommendationCandidateEligibilityResult> {
  if (!isRecord(input) || !isRecord(input.candidate)) {
    throw new TypeError("Invalid recommendation candidate eligibility input.");
  }
  const candidate = input.candidate;
  validateEvidence(candidate, input.evidence);
  validateViewerSafetyEvaluator(input.viewerSafety);

  if (!input.evidence.providerPolicyAllowsRecommendation) {
    return result(candidate, "provider_policy_denied", {
      requiresExplicitSubscription: candidate.kind === "labeler"
    });
  }

  const typeResult = await evaluateTypeSpecificEligibility(candidate, input.evidence, input.signal);
  if (!typeResult.eligible) return typeResult;

  const safetyReason = await applyViewerSafety(candidate, input.viewerSafety, input.signal);
  if (safetyReason !== undefined) {
    return result(candidate, safetyReason, {
      ...(typeResult.resolvedAccount === undefined ? {} : { resolvedAccount: typeResult.resolvedAccount }),
      requiresExplicitSubscription: typeResult.requiresExplicitSubscription
    });
  }
  return typeResult;
}

export async function filterRecommendationEligibleColdStartCandidates(input: {
  candidates: readonly RecommendationColdStartGeneratedCandidate[];
  resolveEvidence(
    candidate: RecommendationCandidate,
    signal?: AbortSignal
  ): RecommendationCandidateEligibilityEvidence | Promise<RecommendationCandidateEligibilityEvidence>;
  viewerSafety?: RecommendationCandidateViewerSafetyEvaluator;
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<RecommendationCandidateEligibilityBatchResult> {
  if (
    !isRecord(input) ||
    !Array.isArray(input.candidates) ||
    input.candidates.length > MAX_BATCH_CANDIDATES ||
    typeof input.resolveEvidence !== "function"
  ) {
    throw new TypeError("Invalid recommendation candidate eligibility batch input.");
  }
  validateViewerSafetyEvaluator(input.viewerSafety);
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new TypeError("Invalid recommendation candidate eligibility concurrency.");
  }
  if (new Set(input.candidates.map((entry) => entry.candidate.candidateId)).size !== input.candidates.length) {
    throw new TypeError("Duplicate recommendation candidate eligibility identity.");
  }
  if (input.signal?.aborted === true) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");

  const evaluations: Array<
    | { status: "ok"; source: RecommendationColdStartGeneratedCandidate; result: RecommendationCandidateEligibilityResult }
    | { status: "failed"; candidateId: string; reason: RecommendationCandidateEligibilityBatchFailure["reason"] }
  > = new Array(input.candidates.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, input.candidates.length) }, async () => {
    while (true) {
      if (input.signal?.aborted === true) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= input.candidates.length) return;
      const source = input.candidates[index];
      if (source === undefined) return;
      let evidence: RecommendationCandidateEligibilityEvidence;
      try {
        evidence = await input.resolveEvidence(source.candidate, input.signal);
      } catch {
        evaluations[index] = {
          status: "failed",
          candidateId: source.candidate.candidateId,
          reason: "evidence_resolution_failed"
        };
        continue;
      }
      try {
        const evaluated = await evaluateRecommendationCandidateEligibility({
          candidate: source.candidate,
          evidence,
          ...(input.viewerSafety === undefined ? {} : { viewerSafety: input.viewerSafety }),
          ...(input.signal === undefined ? {} : { signal: input.signal })
        });
        evaluations[index] = { status: "ok", source, result: evaluated };
      } catch {
        evaluations[index] = {
          status: "failed",
          candidateId: source.candidate.candidateId,
          reason: "evaluation_failed"
        };
      }
    }
  });
  await Promise.all(workers);
  if (input.signal?.aborted === true) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");

  const eligible: RecommendationEligibleColdStartCandidate[] = [];
  const rejected: RecommendationCandidateEligibilityResult[] = [];
  const failures: RecommendationCandidateEligibilityBatchFailure[] = [];
  for (const evaluation of evaluations) {
    if (evaluation === undefined) continue;
    if (evaluation.status === "failed") {
      failures.push(Object.freeze({ candidateId: evaluation.candidateId, reason: evaluation.reason }));
    } else if (evaluation.result.eligible) {
      eligible.push(Object.freeze({
        candidate: evaluation.source.candidate,
        match: evaluation.source.match,
        eligibility: evaluation.result
      }));
    } else {
      rejected.push(evaluation.result);
    }
  }

  return Object.freeze({
    eligible: Object.freeze(eligible),
    rejected: Object.freeze(rejected),
    failures: Object.freeze(failures)
  });
}

export type { RecommendationAccountProfile, RecommendationAccountProfileResolver };
