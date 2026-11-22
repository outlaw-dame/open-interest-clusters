import {
  MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS,
  RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS,
  type RecommendationCuratedAccountSet
} from "./activitypub-curated-account-sets.js";
import {
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidateLifecycleEvent
} from "./candidate-lifecycle.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  createRecommendationCuratedAccountSetMemberCandidateId,
  createRecommendationCuratedAccountSetSourceId
} from "./curated-account-set-candidate-source.js";
import { assertValidRecommendationProfileSubjectId } from "./profile-store-persistence-key.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

/**
 * What the caller got back when it looked at the set again. The caller has to tell these apart:
 * `not_found` means the provider answered and said the set is gone (for example HTTP 404 or 410).
 * Anything else that went wrong, such as a timeout, a 5xx, a rate limit or a parse failure, is
 * `unknown`. An unknown read never produces an event, so an outage cannot hide a set.
 */
export type RecommendationCuratedAccountSetFreshRead =
  | { status: "found"; set: RecommendationCuratedAccountSet }
  | { status: "not_found"; provider: string; setId: string; observedAt: string }
  | { status: "unknown" };

export interface RecommendationCuratedAccountSetChangeInput {
  subjectId: string;
  /** The last snapshot the application saw and accepted. */
  previous: RecommendationCuratedAccountSet;
  fresh: RecommendationCuratedAccountSetFreshRead;
}

export interface RecommendationCuratedAccountSetChangeReport {
  subjectId: string;
  setSourceId: string;
  /** `unknown`: the read told us nothing. `unchanged`: nothing that makes a plan less usable. */
  outcome: "unknown" | "unchanged" | "changed";
  /** Ready for `reportCandidateEvents`. Canonical order, de-duplicated, at most one event per fact. */
  events: readonly RecommendationCandidateLifecycleEvent[];
}

const MEMBER_STATES = new Set<string>(["accepted", "pending", "rejected", "revoked", "unknown"]);
const MAX_TEXT = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkedText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT || value.trim() !== value || hasUnsafeControlCharacter(value)) {
    throw new TypeError("Invalid curated account set change input.");
  }
  return value;
}

function checkedSet(value: unknown): RecommendationCuratedAccountSet {
  if (!isRecord(value) || !(RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS as readonly unknown[]).includes(value.provider)) {
    throw new TypeError("Invalid curated account set change input.");
  }
  checkedText(value.id);
  if (typeof value.discoverable !== "boolean" || typeof value.sensitive !== "boolean" || typeof value.membershipComplete !== "boolean") {
    throw new TypeError("Invalid curated account set change input.");
  }
  if (!Array.isArray(value.members)) throw new TypeError("Invalid curated account set change input.");
  if (value.members.length > MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS) {
    throw new RangeError("Curated account set has more members than a provider allows.");
  }
  for (const member of value.members as unknown[]) {
    if (!isRecord(member) || typeof member.state !== "string" || !MEMBER_STATES.has(member.state)) {
      throw new TypeError("Invalid curated account set change input.");
    }
    checkedText(member.accountId);
    if (member.accountUri !== undefined) checkedText(member.accountUri);
  }
  return value as unknown as RecommendationCuratedAccountSet;
}

function timestamp(value: unknown): string {
  return normalizeStrictRfc3339Timestamp(value, "Invalid curated account set change timestamp.");
}

/**
 * Compares the last snapshot of a curated account set with a fresh read and returns lifecycle events
 * for what got worse. Pure: no network, no timers, and the only time used is the `observedAt` the
 * caller supplied with the reads.
 *
 * Only changes that make a plan less usable produce events. A set that becomes discoverable again,
 * loses its sensitive flag or gains members produces nothing, because those facts can never reopen
 * a plan; they need a new plan built from fresh evidence.
 *
 * Member removal is reported as `member_consent_revoked`, since a member who is no longer listed
 * has no consent on record. It is only reported when the fresh read says its member list is complete,
 * because a partial list proves nothing about who is missing. Members that drop from accepted to
 * pending or unknown have no matching event kind and are not reported.
 *
 * Mismatched provider or set ID, an `observedAt` that runs backwards, malformed snapshots and sets
 * above the provider member cap throw instead of returning a best guess.
 */
export function diffRecommendationCuratedAccountSet(
  input: RecommendationCuratedAccountSetChangeInput
): RecommendationCuratedAccountSetChangeReport {
  if (!isRecord(input)) throw new TypeError("Invalid curated account set change input.");
  assertValidRecommendationProfileSubjectId(input.subjectId);
  const previous = checkedSet(input.previous);
  const previousAt = timestamp(previous.observedAt);
  const setSourceId = createRecommendationCuratedAccountSetSourceId(previous.provider, previous.id);
  const fresh: unknown = input.fresh;
  const report = (outcome: "unknown" | "unchanged" | "changed", events: readonly RecommendationCandidateLifecycleEvent[]) =>
    Object.freeze({ subjectId: input.subjectId, setSourceId, outcome, events });

  if (!isRecord(fresh)) throw new TypeError("Invalid curated account set change input.");
  if (fresh.status === "unknown") return report("unknown", Object.freeze([]));

  const events: RecommendationCandidateLifecycleEvent[] = [];
  let observedAt: string;
  if (fresh.status === "not_found") {
    if (fresh.provider !== previous.provider || fresh.setId !== previous.id) {
      throw new TypeError("Curated account set read does not match the previous snapshot.");
    }
    observedAt = timestamp(fresh.observedAt);
    if (Date.parse(observedAt) < Date.parse(previousAt)) throw new RangeError("Curated account set read is older than the previous snapshot.");
    events.push({ kind: "set_deleted", occurredAt: observedAt, setSourceId });
  } else if (fresh.status === "found") {
    const next = checkedSet(fresh.set);
    if (next.provider !== previous.provider || next.id !== previous.id) {
      throw new TypeError("Curated account set read does not match the previous snapshot.");
    }
    observedAt = timestamp(next.observedAt);
    if (Date.parse(observedAt) < Date.parse(previousAt)) throw new RangeError("Curated account set read is older than the previous snapshot.");
    if (previous.discoverable && !next.discoverable) events.push({ kind: "set_not_discoverable", occurredAt: observedAt, setSourceId });
    if (!previous.sensitive && next.sensitive) events.push({ kind: "set_sensitive", occurredAt: observedAt, setSourceId });
    events.push(...memberEvents(previous, next, observedAt, setSourceId));
  } else {
    throw new TypeError("Invalid curated account set change input.");
  }

  // Normalizing also sorts into the canonical order and drops duplicates. `now` is the read time, so
  // the future-dated check can only trip on a malformed timestamp.
  const normalized = normalizeRecommendationCandidateLifecycleEvents(events, { now: observedAt });
  return report(normalized.length === 0 ? "unchanged" : "changed", normalized);
}

function memberEvents(
  previous: RecommendationCuratedAccountSet,
  next: RecommendationCuratedAccountSet,
  occurredAt: string,
  setSourceId: string
): RecommendationCandidateLifecycleEvent[] {
  const events: RecommendationCandidateLifecycleEvent[] = [];
  // Only accepted members with an actor URI ever became candidates, so only they can be in a plan.
  for (const member of previous.members) {
    if (member.state !== "accepted" || member.accountUri === undefined) continue;
    const matches = next.members.filter((other) => other.accountId === member.accountId && other.accountUri === member.accountUri);
    const candidateId = createRecommendationCuratedAccountSetMemberCandidateId(member.accountUri);
    if (matches.length === 0) {
      if (next.membershipComplete) events.push({ kind: "member_consent_revoked", occurredAt, candidateId, setSourceId });
      continue;
    }
    // Duplicate rows cannot cancel each other out: one bad row is enough.
    if (matches.some((other) => other.state === "revoked")) events.push({ kind: "member_consent_revoked", occurredAt, candidateId, setSourceId });
    if (matches.some((other) => other.state === "rejected")) events.push({ kind: "member_consent_rejected", occurredAt, candidateId, setSourceId });
  }
  return events;
}
