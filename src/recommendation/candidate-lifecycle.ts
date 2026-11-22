import type { RecommendationCandidateActionPlan, RecommendationStarterPackMemberBinding } from "./candidate-action-plan.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENT_SCHEMA_VERSION = "recommendation-candidate-lifecycle-event.v1" as const;
export const RECOMMENDATION_CANDIDATE_PLAN_ASSESSMENT_SCHEMA_VERSION = "recommendation-candidate-plan-assessment.v1" as const;

/**
 * Facts about a candidate or its source that changed after a plan was built. They are reported by the
 * caller. Nothing here is signed, so an event can only make a plan less usable, never more.
 */
export const RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENT_KINDS = [
  "member_consent_revoked",
  "member_consent_rejected",
  "set_deleted",
  "set_not_discoverable",
  "set_sensitive",
  "source_disappeared",
  "account_moved",
  "account_deleted",
  "verification_lost",
  "provider_capability_lost"
] as const;
export type RecommendationCandidateLifecycleEventKind = typeof RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENT_KINDS[number];

export interface RecommendationCandidateLifecycleEvent {
  kind: RecommendationCandidateLifecycleEventKind;
  occurredAt: string;
  /** Candidate the fact is about. A member account for consent events, the set candidate for set events. */
  candidateId?: string;
  /** Account URI, for account events where the candidate ID is not known to the reporter. */
  accountUri?: string;
  /** Curated-set source ID, as produced by `createRecommendationCuratedAccountSetSourceId`. */
  setSourceId?: string;
  /** Provenance source ID that stopped answering. */
  sourceId?: string;
  providerId?: string;
}

export const RECOMMENDATION_CANDIDATE_PLAN_INVALID_REASONS = [
  "member_consent_revoked",
  "member_consent_rejected",
  "set_deleted",
  "set_not_discoverable",
  "set_sensitive",
  "account_moved",
  "account_deleted",
  "verification_lost"
] as const;
export const RECOMMENDATION_CANDIDATE_PLAN_STALE_REASONS = [
  "source_disappeared",
  "provider_capability_lost",
  "capability_expired",
  "eligibility_aged"
] as const;
export type RecommendationCandidatePlanInvalidReason = typeof RECOMMENDATION_CANDIDATE_PLAN_INVALID_REASONS[number];
export type RecommendationCandidatePlanStaleReason = typeof RECOMMENDATION_CANDIDATE_PLAN_STALE_REASONS[number];
export type RecommendationCandidatePlanAssessmentReasonCode = RecommendationCandidatePlanInvalidReason | RecommendationCandidatePlanStaleReason;

export interface RecommendationCandidatePlanAssessmentReason {
  code: RecommendationCandidatePlanAssessmentReasonCode;
  /** Candidates the reason applies to: the plan's candidate, starter-pack members, or both. */
  candidateIds: readonly string[];
}

/**
 * `invalid`: a fact the plan relied on was withdrawn, so the plan must be discarded and rebuilt.
 * `stale`: the plan aged out or lost support, so it must be rebuilt from fresh evidence.
 * `valid`: no known problem. This is not permission to act; the plan still requires explicit user
 * confirmation and identity, eligibility and capability revalidation before any provider mutation.
 */
export interface RecommendationCandidatePlanAssessment {
  schemaVersion: typeof RECOMMENDATION_CANDIDATE_PLAN_ASSESSMENT_SCHEMA_VERSION;
  state: "valid" | "stale" | "invalid";
  usable: boolean;
  executable: false;
  requiresRevalidation: true;
  assessedAt: string;
  reasons: readonly RecommendationCandidatePlanAssessmentReason[];
  /** Members hit by at least one reason. A new plan must not include them without fresh evidence. */
  affectedMemberCandidateIds: readonly string[];
  /** Members no event mentioned. They still need revalidation; this only says nothing was reported. */
  unaffectedMemberCandidateIds: readonly string[];
}

export interface RecommendationCandidatePlanAssessmentOptions {
  now: string;
  /** Maximum age of eligibility evidence. Default 24 hours. */
  maxEligibilityAgeMs?: number;
}

export interface RecommendationCandidateLifecycleNormalizeOptions {
  now: string;
}

export const DEFAULT_RECOMMENDATION_PLAN_MAX_ELIGIBILITY_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS = 1_000;
/** Reporters can be a little ahead of us; anything further out is rejected rather than trusted. */
export const RECOMMENDATION_CANDIDATE_LIFECYCLE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const MIN_ELIGIBILITY_AGE_MS = 60 * 1000;
const MAX_ELIGIBILITY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FIELD_LENGTH = 2_048;
const KIND_SET = new Set<string>(RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENT_KINDS);
const ALLOWED_KEYS: Readonly<Record<RecommendationCandidateLifecycleEventKind, readonly string[]>> = Object.freeze({
  member_consent_revoked: ["candidateId", "setSourceId"],
  member_consent_rejected: ["candidateId", "setSourceId"],
  set_deleted: ["setSourceId", "candidateId"],
  set_not_discoverable: ["setSourceId", "candidateId"],
  set_sensitive: ["setSourceId", "candidateId"],
  source_disappeared: ["sourceId", "candidateId"],
  account_moved: ["candidateId", "accountUri"],
  account_deleted: ["candidateId", "accountUri"],
  verification_lost: ["candidateId"],
  provider_capability_lost: ["providerId"]
});
const REQUIRED_KEYS: Readonly<Record<RecommendationCandidateLifecycleEventKind, readonly string[]>> = Object.freeze({
  member_consent_revoked: ["candidateId", "setSourceId"],
  member_consent_rejected: ["candidateId", "setSourceId"],
  set_deleted: ["setSourceId"],
  set_not_discoverable: ["setSourceId"],
  set_sensitive: ["setSourceId"],
  source_disappeared: ["sourceId"],
  account_moved: [],
  account_deleted: [],
  verification_lost: ["candidateId"],
  provider_capability_lost: ["providerId"]
});
const FIELD_KEYS = ["candidateId", "accountUri", "setSourceId", "sourceId", "providerId"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH || value.trim() !== value || hasUnsafeControlCharacter(value)) {
    throw new TypeError("Invalid recommendation candidate lifecycle event field.");
  }
  return value;
}

/**
 * Caller-supplied times that drive stored decisions must not run ahead of the real clock by more than
 * the allowed skew. Otherwise a far-future value makes live signals look expired.
 */
export function assertRecommendationTimestampNotAhead(timestampMs: number, referenceMs: number, message: string): void {
  if (timestampMs > referenceMs + RECOMMENDATION_CANDIDATE_LIFECYCLE_CLOCK_SKEW_MS) throw new RangeError(message);
}

function nowMillis(value: unknown): number {
  return Date.parse(normalizeStrictRfc3339Timestamp(value, "Invalid recommendation candidate lifecycle timestamp."));
}

function normalizeEvent(raw: unknown, nowMs: number): RecommendationCandidateLifecycleEvent {
  if (!isRecord(raw) || typeof raw.kind !== "string" || !KIND_SET.has(raw.kind)) {
    throw new TypeError("Invalid recommendation candidate lifecycle event.");
  }
  const kind = raw.kind as RecommendationCandidateLifecycleEventKind;
  const allowed = new Set<string>(["kind", "occurredAt", ...ALLOWED_KEYS[kind]]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new TypeError("Unexpected recommendation candidate lifecycle event field.");
  }
  for (const key of REQUIRED_KEYS[kind]) {
    if (raw[key] === undefined) throw new TypeError("Missing recommendation candidate lifecycle event field.");
  }
  if ((kind === "account_moved" || kind === "account_deleted") && raw.candidateId === undefined && raw.accountUri === undefined) {
    throw new TypeError("Recommendation account lifecycle events need a candidate ID or account URI.");
  }
  const occurredAt = normalizeStrictRfc3339Timestamp(raw.occurredAt, "Invalid recommendation candidate lifecycle event timestamp.");
  if (Date.parse(occurredAt) > nowMs + RECOMMENDATION_CANDIDATE_LIFECYCLE_CLOCK_SKEW_MS) {
    throw new TypeError("Recommendation candidate lifecycle event is dated in the future.");
  }
  const event: Record<string, unknown> = { kind, occurredAt };
  for (const key of FIELD_KEYS) {
    if (raw[key] !== undefined) event[key] = fieldText(raw[key]);
  }
  return Object.freeze(event) as unknown as RecommendationCandidateLifecycleEvent;
}

/** Validates, bounds and de-duplicates events. Order is canonical, so the same facts always give the same result. */
export function normalizeRecommendationCandidateLifecycleEvents(
  events: unknown,
  options: RecommendationCandidateLifecycleNormalizeOptions
): readonly RecommendationCandidateLifecycleEvent[] {
  if (!isRecord(options)) throw new TypeError("Invalid recommendation candidate lifecycle options.");
  const nowMs = nowMillis(options.now);
  if (!Array.isArray(events)) throw new TypeError("Invalid recommendation candidate lifecycle events.");
  if (events.length > MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS) {
    throw new RangeError("Recommendation candidate lifecycle event limit exceeded.");
  }
  const byKey = new Map<string, RecommendationCandidateLifecycleEvent>();
  for (const raw of events) {
    const event = normalizeEvent(raw, nowMs);
    byKey.set(JSON.stringify(event, Object.keys(event).sort()), event);
  }
  return Object.freeze([...byKey.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, event]) => event));
}

/**
 * Candidate IDs a caller should keep out of a rerun. Set-level and provider-level events carry no
 * candidate ID of their own, so they only contribute the optional `candidateId` the reporter gave.
 */
export function listRecommendationLifecycleExcludedCandidateIds(
  events: readonly RecommendationCandidateLifecycleEvent[]
): readonly string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.candidateId !== undefined) ids.add(event.candidateId);
  }
  return Object.freeze([...ids].sort());
}

interface Subject {
  candidateId: string;
  accountUri?: string;
  /** Events at or after this instant postdate the evidence the plan was built on. */
  evaluatedAtMs: number;
  memberOf?: RecommendationStarterPackMemberBinding;
}

function collectSubjects(plan: RecommendationCandidateActionPlan): readonly Subject[] {
  const subjects: Subject[] = [{
    candidateId: plan.candidate.candidateId,
    ...(plan.candidate.kind === "account" ? { accountUri: plan.candidate.nativeId } : {}),
    evaluatedAtMs: Date.parse(plan.eligibilityEvaluatedAt)
  }];
  for (const member of plan.members ?? []) {
    subjects.push({ candidateId: member.candidateId, accountUri: member.accountUri, evaluatedAtMs: Date.parse(member.eligibilityEvaluatedAt), memberOf: member });
  }
  return subjects;
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function validProvenance(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item) && nonEmptyString(item.sourceId) && validTimestamp(item.observedAt));
}

function validMember(member: unknown): boolean {
  return isRecord(member) && nonEmptyString(member.candidateId) && nonEmptyString(member.accountUri) && nonEmptyString(member.consentSetSourceId) &&
    validTimestamp(member.eligibilityEvaluatedAt) && validTimestamp(member.consentObservedAt);
}

/** Malformed plans are rejected, because an unparseable timestamp would make every event comparison false and the plan look valid. */
function assertPlanShape(plan: unknown): asserts plan is RecommendationCandidateActionPlan {
  if (
    !isRecord(plan) || plan.schemaVersion !== "recommendation-candidate-action-plan.v1" || plan.executable !== false ||
    !isRecord(plan.candidate) || typeof plan.candidate.candidateId !== "string" ||
    !nonEmptyString(plan.candidate.provider) || !nonEmptyString(plan.candidate.nativeId) || !validProvenance(plan.candidate.provenance) ||
    !validTimestamp(plan.createdAt) || !validTimestamp(plan.eligibilityEvaluatedAt) || !validTimestamp(plan.providerCapabilitiesExpireAt) ||
    (plan.members !== undefined && (!Array.isArray(plan.members) || !plan.members.every(validMember)))
  ) {
    throw new TypeError("Invalid recommendation candidate action plan for lifecycle assessment.");
  }
}

function maxAgeMs(value: unknown): number {
  if (value === undefined) return DEFAULT_RECOMMENDATION_PLAN_MAX_ELIGIBILITY_AGE_MS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MIN_ELIGIBILITY_AGE_MS || value > MAX_ELIGIBILITY_AGE_MS) {
    throw new TypeError("Invalid recommendation plan eligibility age limit.");
  }
  return value;
}

/**
 * Decides whether a frozen action plan can still be used given what has been reported since it was
 * built. Pure and side-effect free: it never executes, repairs or mutates a plan or a provider. A
 * report that is not newer than the evidence it concerns is ignored, and a report at exactly the same
 * instant counts, because the order is then unknowable and the safe reading is that the plan is hit.
 */
export function assessRecommendationCandidateActionPlan(
  planInput: RecommendationCandidateActionPlan,
  eventsInput: readonly RecommendationCandidateLifecycleEvent[],
  options: RecommendationCandidatePlanAssessmentOptions
): RecommendationCandidatePlanAssessment {
  assertPlanShape(planInput);
  const plan = planInput;
  if (!isRecord(options)) throw new TypeError("Invalid recommendation plan assessment options.");
  const assessedAt = normalizeStrictRfc3339Timestamp(options.now, "Invalid recommendation plan assessment timestamp.");
  const nowMs = Date.parse(assessedAt);
  const ageLimit = maxAgeMs(options.maxEligibilityAgeMs);
  const events = normalizeRecommendationCandidateLifecycleEvents(eventsInput, { now: assessedAt });

  const hits = new Map<RecommendationCandidatePlanAssessmentReasonCode, Set<string>>();
  const hit = (code: RecommendationCandidatePlanAssessmentReasonCode, candidateId: string): void => {
    const existing = hits.get(code);
    if (existing === undefined) hits.set(code, new Set([candidateId])); else existing.add(candidateId);
  };

  const subjects = collectSubjects(plan);
  const memberIds = new Set((plan.members ?? []).map((member) => member.candidateId));
  const affectedMembers = new Set<string>();
  const mark = (code: RecommendationCandidatePlanAssessmentReasonCode, subject: Subject): void => {
    hit(code, subject.candidateId);
    if (memberIds.has(subject.candidateId)) affectedMembers.add(subject.candidateId);
  };
  const setSourceIds = new Set((plan.members ?? []).map((member) => member.consentSetSourceId));
  for (const provenance of plan.candidate.provenance) setSourceIds.add(provenance.sourceId);

  const goneSources = new Map<string, number>();
  for (const event of events) {
    const eventMs = Date.parse(event.occurredAt);
    switch (event.kind) {
      case "member_consent_revoked":
      case "member_consent_rejected":
        for (const subject of subjects) {
          const member = subject.memberOf;
          if (member !== undefined && member.candidateId === event.candidateId && member.consentSetSourceId === event.setSourceId && eventMs >= Date.parse(member.consentObservedAt)) mark(event.kind, subject);
        }
        break;
      case "set_deleted":
      case "set_not_discoverable":
      case "set_sensitive": {
        if (event.setSourceId === undefined || !setSourceIds.has(event.setSourceId)) break;
        for (const subject of subjects) {
          const member = subject.memberOf;
          if (member !== undefined && member.consentSetSourceId === event.setSourceId && eventMs >= Date.parse(member.consentObservedAt)) mark(event.kind, subject);
        }
        // A starter-pack candidate that came from the set is hit as a whole.
        const pack = plan.candidate.provenance.find((item) => item.sourceId === event.setSourceId);
        if (pack !== undefined && eventMs >= Date.parse(pack.observedAt)) hit(event.kind, plan.candidate.candidateId);
        break;
      }
      case "source_disappeared":
        if (event.candidateId === undefined || event.candidateId === plan.candidate.candidateId) {
          goneSources.set(event.sourceId!, Math.max(goneSources.get(event.sourceId!) ?? 0, eventMs));
        }
        break;
      case "account_moved":
      case "account_deleted":
      case "verification_lost":
        for (const subject of subjects) {
          const byId = event.candidateId !== undefined && event.candidateId === subject.candidateId;
          const byUri = event.kind !== "verification_lost" && event.accountUri !== undefined && event.accountUri === subject.accountUri;
          if ((byId || byUri) && eventMs >= subject.evaluatedAtMs) mark(event.kind, subject);
        }
        break;
      case "provider_capability_lost":
        if (event.providerId === plan.candidate.provider && eventMs >= Date.parse(plan.createdAt)) hit("provider_capability_lost", plan.candidate.candidateId);
        break;
    }
  }

  // One disappeared source is only a loss of evidence. The plan goes stale when none are left.
  const surviving = plan.candidate.provenance.filter((item) => (goneSources.get(item.sourceId) ?? -1) < Date.parse(item.observedAt));
  if (goneSources.size > 0 && surviving.length === 0 && plan.candidate.provenance.some((item) => (goneSources.get(item.sourceId) ?? -1) >= Date.parse(item.observedAt))) {
    hit("source_disappeared", plan.candidate.candidateId);
  }
  if (nowMs >= Date.parse(plan.providerCapabilitiesExpireAt)) hit("capability_expired", plan.candidate.candidateId);
  for (const subject of subjects) {
    if (nowMs - subject.evaluatedAtMs > ageLimit) mark("eligibility_aged", subject);
  }

  const invalidSet = new Set<string>(RECOMMENDATION_CANDIDATE_PLAN_INVALID_REASONS);
  const reasons = [...hits.entries()]
    .map(([code, ids]): RecommendationCandidatePlanAssessmentReason => Object.freeze({ code, candidateIds: Object.freeze([...ids].sort()) }))
    .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
  const state = reasons.some((reason) => invalidSet.has(reason.code)) ? "invalid" : reasons.length > 0 ? "stale" : "valid";
  const affected = [...affectedMembers].sort();
  return Object.freeze({
    schemaVersion: RECOMMENDATION_CANDIDATE_PLAN_ASSESSMENT_SCHEMA_VERSION,
    state,
    usable: state === "valid",
    executable: false as const,
    requiresRevalidation: true as const,
    assessedAt,
    reasons: Object.freeze(reasons),
    affectedMemberCandidateIds: Object.freeze(affected),
    unaffectedMemberCandidateIds: Object.freeze([...memberIds].filter((id) => !affectedMembers.has(id)).sort())
  });
}
