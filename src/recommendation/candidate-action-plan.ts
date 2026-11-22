import { normalizeRecommendationCandidate, type RecommendationCandidate, type RecommendationCandidateKind } from "./candidate-domain.js";
import type { RecommendationCandidateEligibilityResult } from "./candidate-eligibility.js";
import type { RecommendationCuratedAccountMembershipState } from "./activitypub-curated-account-sets.js";
import { createRecommendationCuratedAccountSetSourceId } from "./curated-account-set-candidate-source.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import { recommendationProviderCapabilityState, type RecommendationProviderCapability, type RecommendationProviderDescriptor } from "./provider-discovery.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION = "recommendation-candidate-action-plan.v1" as const;
export const RECOMMENDATION_CANDIDATE_ACTIONS = ["follow_account", "subscribe_feed", "subscribe_list", "expand_starter_pack", "subscribe_labeler", "follow_community", "follow_hashtag", "open_instance_signup"] as const;
export type RecommendationCandidateAction = typeof RECOMMENDATION_CANDIDATE_ACTIONS[number];
export interface RecommendationCandidateActionPlanInput { candidate: RecommendationCandidate; eligibility: RecommendationCandidateEligibilityResult; provider: RecommendationProviderDescriptor; createdAt: string; maxStarterPackMembers?: number; starterPackMembers?: readonly RecommendationStarterPackMemberInput[]; }
/**
 * One starter-pack member as supplied by the caller: its eligibility result plus the curated-set
 * membership state it was read under. The consent fields are caller-supplied and nothing here checks a proof for them.
 */
export interface RecommendationStarterPackMemberInput { eligibility: RecommendationCandidateEligibilityResult; consent: { state: RecommendationCuratedAccountMembershipState; setProvider: string; setId: string; observedAt: string }; }
/** One starter-pack member, bound to the account identity its eligibility result resolved and to its accepted membership. */
export interface RecommendationStarterPackMemberBinding { candidateId: string; accountId: string; accountUri: string; eligibilityEvaluatedAt: string; consentState: "accepted"; consentSetSourceId: string; consentObservedAt: string; }
export interface RecommendationCandidateActionPlan { schemaVersion: typeof RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION; candidate: RecommendationCandidate; action: RecommendationCandidateAction; createdAt: string; eligibilityEvaluatedAt: string; providerCapabilitiesExpireAt: string; requiresExplicitUserConfirmation: true; requiresIdentityRevalidation: true; requiresEligibilityRevalidation: true; requiresCapabilityRevalidation: true; executable: false; maxStarterPackMembers?: number; members?: readonly RecommendationStarterPackMemberBinding[]; }

const DEFAULT_MAX_STARTER_PACK_MEMBERS = 100;
const MAX_STARTER_PACK_MEMBERS = 1_000;
const MAX_IDENTITY_LENGTH = 2_048;
const ACTION_BY_KIND: Readonly<Partial<Record<RecommendationCandidateKind, RecommendationCandidateAction>>> = Object.freeze({ account: "follow_account", feed: "subscribe_feed", list: "subscribe_list", starter_pack: "expand_starter_pack", labeler: "subscribe_labeler", community: "follow_community", hashtag: "follow_hashtag", instance: "open_instance_signup" });
const CAPABILITY_BY_KIND: Readonly<Partial<Record<RecommendationCandidateKind, RecommendationProviderCapability>>> = Object.freeze({ account: "follows", feed: "feeds", list: "lists", starter_pack: "starter_packs", labeler: "labels", community: "communities", hashtag: "hashtags" });

function starterPackLimit(value: unknown): number { if (value === undefined) return DEFAULT_MAX_STARTER_PACK_MEMBERS; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_STARTER_PACK_MEMBERS) throw new TypeError("Invalid recommendation starter-pack action limit."); return value; }
function identityText(value: unknown): string { if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTITY_LENGTH || value.trim() !== value || hasUnsafeControlCharacter(value)) throw new TypeError("Invalid recommendation starter-pack member identity."); return value; }
function bindStarterPackMembers(value: unknown, limit: number, createdAt: string): readonly RecommendationStarterPackMemberBinding[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("Recommendation starter-pack action plan requires at least one eligible member.");
  if (value.length > limit) throw new TypeError("Recommendation starter-pack members exceed the action limit.");
  const seenAccounts = new Set<string>(); const seenCandidates = new Set<string>();
  const bindings = value.map((entry: unknown): RecommendationStarterPackMemberBinding => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid recommendation starter-pack member eligibility.");
    const { eligibility, consent } = entry as RecommendationStarterPackMemberInput;
    if (eligibility === null || typeof eligibility !== "object" || Array.isArray(eligibility)) throw new TypeError("Invalid recommendation starter-pack member eligibility.");
    if (consent === null || typeof consent !== "object" || Array.isArray(consent)) throw new TypeError("Invalid recommendation starter-pack member consent.");
    const result = eligibility;
    const member = normalizeRecommendationCandidate(result.candidate);
    if (member.kind !== "account") throw new TypeError("Recommendation starter-pack members must be account candidates.");
    if (result.eligible !== true || !Array.isArray(result.reasonCodes) || result.reasonCodes.length !== 1 || result.reasonCodes[0] !== "eligible") throw new TypeError("Recommendation starter-pack member requires explicit eligible evidence.");
    const account = result.resolvedAccount;
    if (account === null || typeof account !== "object" || Array.isArray(account)) throw new TypeError("Recommendation starter-pack member requires a resolved account identity.");
    if (account.deactivated === true || account.suspended === true || account.deleted === true) throw new TypeError("Recommendation starter-pack member resolved to an unavailable account.");
    const evaluatedAt = normalizeStrictRfc3339Timestamp(result.evaluatedAt, "Invalid recommendation starter-pack member eligibility timestamp.");
    if (Date.parse(evaluatedAt) > Date.parse(createdAt)) throw new TypeError("Recommendation starter-pack member eligibility cannot be newer than the plan.");
    const accountId = identityText(account.id); const accountUri = identityText(account.uri);
    if (member.nativeId !== accountUri) throw new TypeError("Recommendation starter-pack member candidate must match its resolved account URI.");
    if (consent.state !== "accepted") throw new TypeError("Recommendation starter-pack member requires accepted membership consent.");
    const consentSourceId = createRecommendationCuratedAccountSetSourceId(identityText(consent.setProvider), identityText(consent.setId));
    const consentObservedAt = normalizeStrictRfc3339Timestamp(consent.observedAt, "Invalid recommendation starter-pack member consent timestamp.");
    if (Date.parse(consentObservedAt) > Date.parse(createdAt)) throw new TypeError("Recommendation starter-pack member consent cannot be newer than the plan.");
    const bound = member.provenance.some((item) => item.kind === "curated_account_set" && item.sourceId === consentSourceId && item.observedAt === consentObservedAt && typeof item.sourceItemId === "string" && item.sourceItemId.length > 0);
    if (!bound) throw new TypeError("Recommendation starter-pack member consent must match curated-set provenance on the candidate.");
    if (seenAccounts.has(accountId) || seenCandidates.has(member.candidateId)) throw new TypeError("Recommendation starter-pack members must resolve to distinct accounts.");
    seenAccounts.add(accountId); seenCandidates.add(member.candidateId);
    return Object.freeze({ candidateId: member.candidateId, accountId, accountUri, eligibilityEvaluatedAt: evaluatedAt, consentState: "accepted", consentSetSourceId: consentSourceId, consentObservedAt });
  });
  return Object.freeze(bindings);
}
function equalStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameCandidateSnapshot(left: RecommendationCandidate, right: RecommendationCandidate): boolean {
  if (left.candidateId !== right.candidateId || left.kind !== right.kind || left.protocol !== right.protocol || left.nativeId !== right.nativeId || left.provider !== right.provider || left.uri !== right.uri || left.observedAt !== right.observedAt || left.availability !== right.availability || left.verification.state !== right.verification.state || left.verification.authority !== right.verification.authority || left.verification.verifiedAt !== right.verification.verifiedAt || left.metadata.displayName !== right.metadata.displayName || left.metadata.summary !== right.metadata.summary || !equalStrings(left.metadata.canonicalInterestIds, right.metadata.canonicalInterestIds) || !equalStrings(left.metadata.tags, right.metadata.tags) || !equalStrings(left.metadata.entityIds, right.metadata.entityIds) || !equalStrings(left.metadata.languages, right.metadata.languages) || left.provenance.length !== right.provenance.length) return false;
  return left.provenance.every((item, index) => { const other = right.provenance[index]; return other !== undefined && item.kind === other.kind && item.sourceId === other.sourceId && item.observedAt === other.observedAt && item.trustBoundary === other.trustBoundary && item.sourceItemId === other.sourceItemId && item.curator === other.curator && item.sourceUrl === other.sourceUrl; });
}
function requireProviderCapability(candidate: RecommendationCandidate, provider: RecommendationProviderDescriptor, createdAt: string): string {
  if (candidate.protocol === "unknown" || candidate.provider === undefined) throw new TypeError("Recommendation candidate action plan requires a known provider protocol.");
  if (provider === null || typeof provider !== "object" || Array.isArray(provider) || provider.providerId !== candidate.provider) throw new TypeError("Recommendation candidate action plan requires matching provider capability evidence.");
  const detectedAt = normalizeStrictRfc3339Timestamp(provider.detectedAt, "Invalid recommendation provider capability detection timestamp.");
  const expiresAt = normalizeStrictRfc3339Timestamp(provider.expiresAt, "Invalid recommendation provider capability expiration timestamp.");
  if (Date.parse(detectedAt) > Date.parse(createdAt) || Date.parse(expiresAt) <= Date.parse(createdAt)) throw new TypeError("Recommendation candidate action plan requires fresh provider capability evidence.");
  if (!Array.isArray(provider.protocolBindings) || !provider.protocolBindings.some((binding) => binding?.protocol === candidate.protocol && binding.verification === "verified")) throw new TypeError("Recommendation candidate action plan requires a verified provider protocol binding.");
  const capability = CAPABILITY_BY_KIND[candidate.kind];
  if (capability !== undefined && recommendationProviderCapabilityState(provider, capability, candidate.protocol) !== "supported") throw new TypeError("Recommendation candidate action plan requires supported provider action capability.");
  return expiresAt;
}

export function createRecommendationCandidateActionPlan(input: RecommendationCandidateActionPlanInput): RecommendationCandidateActionPlan {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid recommendation candidate action-plan input.");
  const candidate = normalizeRecommendationCandidate(input.candidate);
  if (input.eligibility === null || typeof input.eligibility !== "object" || Array.isArray(input.eligibility)) throw new TypeError("Invalid recommendation candidate action-plan eligibility.");
  const eligibilityCandidate = normalizeRecommendationCandidate(input.eligibility.candidate);
  if (input.eligibility.eligible !== true || !sameCandidateSnapshot(candidate, eligibilityCandidate)) throw new TypeError("Recommendation candidate action plan requires current eligibility for the exact candidate snapshot.");
  if (!Array.isArray(input.eligibility.reasonCodes) || input.eligibility.reasonCodes.length !== 1 || input.eligibility.reasonCodes[0] !== "eligible") throw new TypeError("Recommendation candidate action plan requires explicit eligible evidence.");
  const action = ACTION_BY_KIND[candidate.kind];
  if (action === undefined) throw new TypeError("Recommendation candidate kind has no mutation action-plan contract.");
  const createdAt = normalizeStrictRfc3339Timestamp(input.createdAt, "Invalid recommendation candidate action-plan timestamp.");
  const eligibilityEvaluatedAt = normalizeStrictRfc3339Timestamp(input.eligibility.evaluatedAt, "Invalid recommendation candidate action-plan eligibility timestamp.");
  if (Date.parse(eligibilityEvaluatedAt) > Date.parse(createdAt)) throw new TypeError("Recommendation candidate action-plan eligibility cannot be newer than the plan.");
  const providerCapabilitiesExpireAt = requireProviderCapability(candidate, input.provider, createdAt);
  const plan: RecommendationCandidateActionPlan = { schemaVersion: RECOMMENDATION_CANDIDATE_ACTION_PLAN_SCHEMA_VERSION, candidate, action, createdAt, eligibilityEvaluatedAt, providerCapabilitiesExpireAt, requiresExplicitUserConfirmation: true, requiresIdentityRevalidation: true, requiresEligibilityRevalidation: true, requiresCapabilityRevalidation: true, executable: false };
  if (candidate.kind === "starter_pack") { const limit = starterPackLimit(input.maxStarterPackMembers); plan.maxStarterPackMembers = limit; plan.members = bindStarterPackMembers(input.starterPackMembers, limit, createdAt); } else if (input.maxStarterPackMembers !== undefined || input.starterPackMembers !== undefined) throw new TypeError("Starter-pack action limit and members are only valid for starter-pack candidates.");
  return Object.freeze(plan);
}
