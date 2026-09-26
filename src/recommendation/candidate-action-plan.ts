import { normalizeRecommendationCandidate, type RecommendationCandidate, type RecommendationCandidateKind } from "./candidate-domain.js";
import type { RecommendationCandidateEligibilityResult } from "./candidate-eligibility.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION = "recommendation-candidate-action-plan.v1" as const;
export const RECOMMENDATION_CANDIDATE_ACTIONS = ["follow_account", "subscribe_feed", "subscribe_list", "expand_starter_pack", "subscribe_labeler", "follow_community", "follow_hashtag", "open_instance_signup"] as const;
export type RecommendationCandidateAction = typeof RECOMMENDATION_CANDIDATE_ACTIONS[number];

export interface RecommendationCandidateActionPlanInput { candidate: RecommendationCandidate; eligibility: RecommendationCandidateEligibilityResult; createdAt: string; maxStarterPackMembers?: number; }
export interface RecommendationCandidateActionPlan { schemaVersion: typeof RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION; candidate: RecommendationCandidate; action: RecommendationCandidateAction; createdAt: string; eligibilityEvaluatedAt: string; requiresExplicitUserConfirmation: true; requiresIdentityRevalidation: true; requiresEligibilityRevalidation: true; executable: false; maxStarterPackMembers?: number; }

const DEFAULT_MAX_STARTER_PACK_MEMBERS = 100;
const MAX_STARTER_PACK_MEMBERS = 1_000;
const ACTION_BY_KIND: Readonly<Partial<Record<RecommendationCandidateKind, RecommendationCandidateAction>>> = Object.freeze({ account: "follow_account", feed: "subscribe_feed", list: "subscribe_list", starter_pack: "expand_starter_pack", labeler: "subscribe_labeler", community: "follow_community", hashtag: "follow_hashtag", instance: "open_instance_signup" });

function starterPackLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_STARTER_PACK_MEMBERS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_STARTER_PACK_MEMBERS) throw new TypeError("Invalid recommendation starter-pack action limit.");
  return value;
}
function equalStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameCandidateSnapshot(left: RecommendationCandidate, right: RecommendationCandidate): boolean {
  if (left.candidateId !== right.candidateId || left.kind !== right.kind || left.protocol !== right.protocol || left.nativeId !== right.nativeId || left.provider !== right.provider || left.uri !== right.uri || left.observedAt !== right.observedAt || left.availability !== right.availability || left.verification.state !== right.verification.state || left.verification.authority !== right.verification.authority || left.verification.verifiedAt !== right.verification.verifiedAt || left.metadata.displayName !== right.metadata.displayName || left.metadata.summary !== right.metadata.summary || !equalStrings(left.metadata.canonicalInterestIds, right.metadata.canonicalInterestIds) || !equalStrings(left.metadata.tags, right.metadata.tags) || !equalStrings(left.metadata.entityIds, right.metadata.entityIds) || !equalStrings(left.metadata.languages, right.metadata.languages) || left.provenance.length !== right.provenance.length) return false;
  return left.provenance.every((item, index) => { const other = right.provenance[index]; return other !== undefined && item.kind === other.kind && item.sourceId === other.sourceId && item.observedAt === other.observedAt && item.trustBoundary === other.trustBoundary && item.sourceItemId === other.sourceItemId && item.curator === other.curator && item.sourceUrl === other.sourceUrl; });
}

export function createRecommendationCandidateActionPlan(input: RecommendationCandidateActionPlanInput): RecommendationCandidateActionPlan {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid recommendation candidate action-plan input.");
  const candidate = normalizeRecommendationCandidate(input.candidate);
  if (input.eligibility === null || typeof input.eligibility !== "object" || Array.isArray(input.eligibility)) throw new TypeError("Invalid recommendation candidate action-plan eligibility.");
  const eligibilityCandidate = normalizeRecommendationCandidate(input.eligibility.candidate);
  if (!input.eligibility.eligible || !sameCandidateSnapshot(candidate, eligibilityCandidate)) throw new TypeError("Recommendation candidate action plan requires current eligibility for the exact candidate snapshot.");
  if (!Array.isArray(input.eligibility.reasonCodes) || input.eligibility.reasonCodes.length !== 1 || input.eligibility.reasonCodes[0] !== "eligible") throw new TypeError("Recommendation candidate action plan requires explicit eligible evidence.");
  const action = ACTION_BY_KIND[candidate.kind];
  if (action === undefined) throw new TypeError("Recommendation candidate kind has no mutation action-plan contract.");
  const createdAt = normalizeStrictRfc3339Timestamp(input.createdAt, "Invalid recommendation candidate action-plan timestamp.");
  const eligibilityEvaluatedAt = normalizeStrictRfc3339Timestamp(input.eligibility.evaluatedAt, "Invalid recommendation candidate action-plan eligibility timestamp.");
  if (Date.parse(eligibilityEvaluatedAt) > Date.parse(createdAt)) throw new TypeError("Recommendation candidate action-plan eligibility cannot be newer than the plan.");
  const plan: RecommendationCandidateActionPlan = { schemaVersion: RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION, candidate, action, createdAt, eligibilityEvaluatedAt, requiresExplicitUserConfirmation: true, requiresIdentityRevalidation: true, requiresEligibilityRevalidation: true, executable: false };
  if (candidate.kind === "starter_pack") plan.maxStarterPackMembers = starterPackLimit(input.maxStarterPackMembers);
  else if (input.maxStarterPackMembers !== undefined) throw new TypeError("Starter-pack action limit is only valid for starter-pack candidates.");
  return Object.freeze(plan);
}
