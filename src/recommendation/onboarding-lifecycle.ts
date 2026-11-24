import { sha256Hex } from "../runtime/hash.js";
import { executeWithRetry, type RetryPolicyOptions } from "../utils/retry-policy.js";
import {
  assertRecommendationCandidateEventStore,
  buildRecommendationCandidateEventRecord,
  mergeRecommendationCandidateEventEntries,
  normalizeRecommendationCandidateEventStoreLimits,
  readRecommendationCandidateEventRecord,
  recommendationCandidateEventRecordDigest,
  selectNewRecommendationCandidateEvents,
  RecommendationCandidateEventConflictError,
  checkRecommendationCandidateEventStoreCompareAndSet,
  type RecommendationCandidateEventStore,
  type RecommendationCandidateEventStoreLimits
} from "./candidate-event-store.js";
import type { RecommendationCandidateActionPlan } from "./candidate-action-plan.js";
import { RecommendationConsentDeniedError, requireRecommendationConsent } from "./consent-enforcement.js";
import type { RecommendationConsentPolicy } from "./consent.js";
import {
  RECOMMENDATION_EVIDENCE_UNVERIFIED,
  combineRecommendationEvidenceVerification,
  verifyRecommendationEvidence,
  type NormalizedRecommendationEvidenceVerifier,
  type RecommendationEvidenceVerification
} from "./evidence-verifier.js";
import {
  assertRecommendationEvidenceAttestationList,
  normalizeRecommendationEvidenceVerificationOptions,
  type RecommendationEvidenceAttestation,
  type RecommendationEvidenceVerificationOptions
} from "./evidence-attestation.js";
import {
  assertRecommendationTimestampNotAhead,
  assessRecommendationCandidateActionPlanWithEvidence,
  type RecommendationCandidatePlanAssessmentWithEvidence,
  listRecommendationLifecycleExcludedCandidateIds,
  listRecommendationLifecycleExcludedSetSourceIds,
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidateLifecycleEvent
} from "./candidate-lifecycle.js";
import type {
  RecommendationCandidateStateInvalidator,
  RecommendationDerivedStateInvalidationOrchestrator,
  RecommendationDerivedStateProcessResult,
  RecommendationDerivedStatePropagationResult
} from "./derived-state-invalidation-orchestrator.js";
import type { RecommendationEngineEventHistoryReader } from "./engine-orchestrator.js";
import type {
  RecommendationFirstSessionOrchestrator,
  RecommendationFirstSessionRequest,
  RecommendationFirstSessionResult
} from "./first-session-orchestrator.js";
import type { RecommendationInterestSignal } from "./interest-signal.js";
import { hasExcludedProvenanceSource } from "./provenance-source-exclusion.js";
import { getSharedRecommendationKeyedSerializer } from "./keyed-serializer.js";
import { deleteStoredRecommendationCandidateEvents, registerRecommendationCandidateEventStoreForDeletion } from "./candidate-event-deletion-registry.js";
import {
  buildRecommendationOnboardingSignals,
  type RecommendationOnboardingProfileSeedInput
} from "./onboarding-profile-seed.js";
import { assertValidRecommendationProfileSubjectId } from "./profile-store-persistence-key.js";
import type {
  RecommendationSignalLedgerEventInput,
  RecommendationSignalRetractionReason
} from "./signal-ledger.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";
import {
  RecommendationSubjectLockError,
  normalizeRecommendationSubjectLockOptions,
  withRecommendationSubjectLock,
  type RecommendationSubjectLockOptions
} from "./subject-lock.js";

/** Stands in for the hold signal when no subject lock is configured, so the same code path runs either way. */
const NEVER_ABORTED: AbortSignal = new AbortController().signal;

/**
 * The signal for the first session. The caller's own signal still counts, so either one stops it. With
 * no lock the hold signal never aborts and is not passed on. Combining with it would leave a new
 * entry on that one long-lived signal for every refresh, which Node does not release promptly, and it
 * would hand the first session a signal where it got none before.
 */
function firstSessionSignal(caller: AbortSignal | undefined, hold: AbortSignal): { signal?: AbortSignal } {
  if (hold === NEVER_ABORTED) return caller === undefined ? {} : { signal: caller };
  return { signal: caller === undefined ? hold : AbortSignal.any([caller, hold]) };
}

/** Reasons a caller may give when withdrawing every onboarding selection at once. */
export const RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS = ["source_retracted", "consent_revoked"] as const;
export type RecommendationOnboardingWithdrawalReason = typeof RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS[number];

export type RecommendationOnboardingSelectionChangeInput =
  Omit<RecommendationOnboardingProfileSeedInput, "profileStore"> & { now?: string };

export interface RecommendationOnboardingSelectionChangeResult {
  subjectId: string;
  /** Targets written for the first time, or again after an earlier withdrawal or expiry. */
  added: readonly string[];
  /** Targets whose live signal was replaced because its strength, confidence, boundary or expiry changed. */
  updated: readonly string[];
  /** Targets whose live signal was retracted because the selection no longer contains them. */
  removed: readonly string[];
  /** Targets that already matched the live signal and were left alone. */
  unchangedCount: number;
  eventCount: number;
  processing: RecommendationDerivedStateProcessResult;
}

export interface RecommendationOnboardingWithdrawalInput {
  subjectId: string;
  reason: RecommendationOnboardingWithdrawalReason;
  now?: string;
}

export interface RecommendationOnboardingCandidateReportResult {
  subjectId: string;
  acceptedEventCount: number;
  excludedCandidateIds: readonly string[];
  propagation: RecommendationDerivedStatePropagationResult | undefined;
}

/** What `reportCandidateEvents` returns from the library's lifecycle: the 0.2.0 result plus what the verifier checked. */
export interface RecommendationOnboardingCandidateReportResultWithEvidence
  extends RecommendationOnboardingCandidateReportResult, RecommendationEvidenceVerification {}

export interface RecommendationOnboardingCandidateReportInput {
  subjectId: string;
  events: readonly RecommendationCandidateLifecycleEvent[];
  /** Required when a candidate event store is configured: storing events needs current consent. */
  policy?: RecommendationConsentPolicy;
  /** Issued evidence attestations for these events. Only read when the lifecycle has `evidenceVerifier.minimumAttestation`. */
  attestations?: readonly RecommendationEvidenceAttestation[];
  now?: string;
}

export interface RecommendationOnboardingRefreshInput {
  request: RecommendationFirstSessionRequest;
  /**
   * Required when events are reported and a candidate event store is configured. When given on a
   * refresh that reports nothing, consent is checked before stored events are read, and denied
   * consent deletes them. Without it, stored events are still read and only ever exclude more.
   */
  policy?: RecommendationConsentPolicy;
  /** Candidate facts that changed since the last run. Reported before the rerun, so caches are cleared first. */
  candidateEvents?: readonly RecommendationCandidateLifecycleEvent[];
  /** Issued evidence attestations for `candidateEvents`. Only read when the lifecycle has `evidenceVerifier.minimumAttestation`. */
  attestations?: readonly RecommendationEvidenceAttestation[];
  now?: string;
}

export interface RecommendationOnboardingRefreshResult {
  result: RecommendationFirstSessionResult;
  /** Includes candidates excluded by events stored from earlier reports, when a store is configured. */
  excludedCandidateIds: readonly string[];
  propagation: RecommendationDerivedStatePropagationResult;
}

/** What `refresh` returns from the library's lifecycle: the 0.2.0 result plus the set-level exclusions it applied. */
export interface RecommendationOnboardingRefreshResultWithSetExclusions extends RecommendationOnboardingRefreshResult {
  /** Curated-set source IDs left out because a set-level event was reported for them. */
  excludedSetSourceIds: readonly string[];
}

export interface RecommendationOnboardingLifecycleOptions {
  /**
   * The invalidating wrapper around the engine. All writes go through it. `invalidateCandidateState` is
   * optional: without it `reportCandidateEvents` (and a `refresh` that reports events) throws before
   * anything is stored, because candidate caches could not be cleared. This is checked on the call, not
   * when the lifecycle is created. Everything else still works.
   */
  derived: Pick<RecommendationDerivedStateInvalidationOrchestrator, "process" | "repair"> & Partial<RecommendationCandidateStateInvalidator>;
  /**
   * The same engine the wrapper drives. Only used to read accepted event history. `readEventHistory`
   * is optional: without it `applySelection` and `withdrawSelections` throw, because the live selections
   * could not be worked out. The check happens on the first call, not when the lifecycle is created.
   * `applySelection` and non-revoking withdrawals fail before the ledger is touched. A `consent_revoked`
   * withdrawal still clears stored candidate events first, since revoked consent should delete them
   * whether or not the history can be read. Event reports, plan assessment and refresh still work.
   */
  engine: object & Partial<RecommendationEngineEventHistoryReader>;
  firstSession?: Pick<RecommendationFirstSessionOrchestrator, "execute">;
  now?: () => string;
  /**
   * Optional lock the application provides (Web Locks, a database advisory lock, and so on) so
   * writes for one subject do not overlap across processes or devices. The library has none of its
   * own and gives no cross-process guarantee without it. When set, `applySelection`,
   * `withdrawSelections`, `reportCandidateEvents`, `assessPlan` and `refresh` take it after the
   * in-process queue and hold it until the call finishes, including any verifier, source or
   * first-session call made inside. Acquire failure, timeout or abort rejects with a
   * `RecommendationSubjectLockError` before anything is written. The lock also has a hold deadline
   * (`maxHoldMs`): past it the work is told to stop (see `RecommendationSubjectLockOptions`).
   */
  subjectLock?: RecommendationSubjectLockOptions;
  /**
   * Optional check that reported events and plan consent and provenance are real. Without it they are
   * used as supplied and results say `unverified`. With it, evidence the verifier does not accept
   * is refused before anything is stored or any cache is cleared.
   *
   * Set `minimumAttestation` here to require attestations. It is off by default. When set, every
   * reported event, plan member consent and curated-set provenance entry is accepted only if one of
   * the `attestations` passed to that call covers it. `verifier` is then optional.
   */
  evidenceVerifier?: RecommendationEvidenceVerificationOptions;
  /**
   * Optional durable home for reported candidate events. Leave it out and events are only used for
   * the call that reports them, as before. The store must be device-owned or user-owned.
   */
  candidateEvents?: {
    store: RecommendationCandidateEventStore;
    /** How long a stored event counts. Default 30 days, at most 90. */
    retentionMs?: number;
    /**
     * How long set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`) count, so a
     * "never show this set" can outlive ordinary events. Defaults to `retentionMs`. It may not be
     * shorter than `retentionMs` and is at most 365 days. Deletion and revoked consent still clear them at once.
     */
    setExclusionRetentionMs?: number;
    /** Cap per subject. The oldest events are compacted first. Default and maximum 1000. */
    maxEvents?: number;
    /** Backoff for store reads, writes and deletes. Defaults to 4 attempts from 25 ms, doubling, with jitter. */
    retry?: Pick<RetryPolicyOptions, "attempts" | "initialDelayMs" | "maxDelayMs" | "jitterRatio" | "random" | "retrySleeper">;
  };
}

export interface RecommendationOnboardingPlanAssessmentInput {
  subjectId: string;
  plan: RecommendationCandidateActionPlan;
  /** When given, consent is checked before stored events are read, and denied consent deletes them. */
  policy?: RecommendationConsentPolicy;
  /** Extra events to consider on top of the stored ones. */
  events?: readonly RecommendationCandidateLifecycleEvent[];
  /** Issued evidence attestations for the extra events, the plan's member consent and its curated-set provenance. Only read when the lifecycle has `evidenceVerifier.minimumAttestation`. */
  attestations?: readonly RecommendationEvidenceAttestation[];
  maxEligibilityAgeMs?: number;
  now?: string;
}

export interface RecommendationOnboardingLifecycle {
  /**
   * Makes the subject's live onboarding signals match the given selection. Selections that disappeared
   * are retracted, edited ones are replaced, and untouched ones are not written again, so repeating
   * the same call changes nothing.
   */
  applySelection(input: RecommendationOnboardingSelectionChangeInput): Promise<RecommendationOnboardingSelectionChangeResult>;
  /** Retracts every live onboarding signal. Use `consent_revoked` when the user withdrew consent. */
  withdrawSelections(input: RecommendationOnboardingWithdrawalInput): Promise<RecommendationOnboardingSelectionChangeResult>;
  /** Records changed candidate facts: durably clears the candidate and explanation caches. */
  reportCandidateEvents(input: { subjectId: string; events: readonly RecommendationCandidateLifecycleEvent[]; now?: string }): Promise<RecommendationOnboardingCandidateReportResult>;
  /** Settles pending invalidation, reports candidate facts, then reruns the first session without the withdrawn candidates. */
  refresh(input: RecommendationOnboardingRefreshInput): Promise<RecommendationOnboardingRefreshResult>;
}

/**
 * What `createRecommendationOnboardingLifecycle` returns. It is `RecommendationOnboardingLifecycle`
 * plus the candidate event store and plan assessment methods, with richer results. It is a separate
 * interface so a hand-written `RecommendationOnboardingLifecycle` written before these methods existed
 * still compiles. This type is assignable to the base one.
 */
export interface RecommendationOnboardingLifecycleWithCandidateEvents extends RecommendationOnboardingLifecycle {
  /**
   * With a candidate event store, the events are saved first and the call fails if they cannot be, so a
   * success never claims more than was kept.
   */
  reportCandidateEvents(input: RecommendationOnboardingCandidateReportInput): Promise<RecommendationOnboardingCandidateReportResultWithEvidence>;
  /** Stored events that have not expired, oldest first. Throws when no candidate event store is configured. */
  listReportedCandidateEvents(input: { subjectId: string; now?: string }): Promise<readonly RecommendationCandidateLifecycleEvent[]>;
  /** Assesses a plan against the stored events plus any extra ones. Throws when no candidate event store is configured. */
  assessPlan(input: RecommendationOnboardingPlanAssessmentInput): Promise<RecommendationCandidatePlanAssessmentWithEvidence>;
  refresh(input: RecommendationOnboardingRefreshInput): Promise<RecommendationOnboardingRefreshResultWithSetExclusions>;
}

/** A few quick replans with jittered backoff. A lost race normally settles on the first one. */
const STALE_PLAN_RETRY = Object.freeze({ attempts: 5, initialDelayMs: 5, maxDelayMs: 100, jitterRatio: 0.5 });

const CANDIDATE_EVENT_STORE_RETRY = Object.freeze({ attempts: 4, initialDelayMs: 25, maxDelayMs: 400, jitterRatio: 0.5 });

/** Reload-and-merge attempts when a compare-and-set store reports that another writer got there first. */
const CANDIDATE_EVENT_CONFLICT_RETRY = Object.freeze({ attempts: 6, initialDelayMs: 10, maxDelayMs: 200, jitterRatio: 0.5 });

/** Largest exclusion list the first session accepts. Mirrors the candidate generation limit. */
const MAX_EXCLUSION_IDS = 5_000;

/** Marks a failed write that happened while the ledger moved under the plan, so the plan can be redone. */
class StalePlanError extends Error {
  constructor(readonly original: unknown) { super("Onboarding plan was based on stale history."); }
}

const SOURCE_EVENT_PREFIX = "onboarding:v1:";
const OPERATION_PREFIX = "onboarding-op:v1:";
const SOURCE_EVENT_PATTERN = /^onboarding:v1:g(\d{1,9}):([0-9a-f]{64})$/u;
const WITHDRAWAL_REASON_SET = new Set<string>(RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function targetHash(signal: RecommendationInterestSignal): string {
  return sha256Hex(`${signal.target.kind}\u0000${signal.target.key}`);
}

function targetLabel(signal: RecommendationInterestSignal): string {
  return `${signal.target.kind}:${signal.target.key}`;
}

/** What makes two onboarding signals "the same selection". Audit fields and timestamps are left out on purpose. */
function contentDigest(signal: RecommendationInterestSignal): string {
  return sha256Hex(JSON.stringify([
    signal.target.kind, signal.target.key, signal.action, signal.polarity, signal.strength,
    signal.confidence, signal.dataUse, signal.privacyBoundary, signal.expiresAt ?? null
  ]));
}

function sourceEventIdFor(hash: string, generation: number): string {
  return `${SOURCE_EVENT_PREFIX}g${generation}:${hash}`;
}

interface LiveEntry { sourceEventId: string; generation: number; digest: string; label: string }
interface HistoryView {
  live: Map<string, LiveEntry[]>;
  nextGeneration: Map<string, number>;
}

/**
 * Replays the accepted history to find which onboarding signals are live. Signals are only recognized
 * when their event ID has the exact onboarding shape and its hash matches the signal's own target, so
 * an unrelated event cannot be mistaken for, or retracted as, an onboarding selection.
 */
function readHistory(history: readonly RecommendationSignalLedgerEventInput[], nowMs: number): HistoryView {
  const retracted = new Set<string>();
  for (const event of history) {
    if (event.operation === "retract") retracted.add(event.retractsSourceEventId);
  }
  const live = new Map<string, LiveEntry[]>();
  const nextGeneration = new Map<string, number>();
  for (const event of history) {
    if (event.operation !== "apply") continue;
    const match = SOURCE_EVENT_PATTERN.exec(event.sourceEventId);
    if (match === null) continue;
    const hash = match[2]!;
    if (hash !== targetHash(event.signal)) continue;
    const generation = Number.parseInt(match[1]!, 10);
    nextGeneration.set(hash, Math.max(nextGeneration.get(hash) ?? 0, generation + 1));
    if (retracted.has(event.sourceEventId)) continue;
    if (event.signal.expiresAt !== undefined && Date.parse(event.signal.expiresAt) <= nowMs) continue;
    const entries = live.get(hash) ?? [];
    entries.push({ sourceEventId: event.sourceEventId, generation, digest: contentDigest(event.signal), label: targetLabel(event.signal) });
    live.set(hash, entries);
  }
  return { live, nextGeneration };
}

function retractEvent(entry: LiveEntry, reason: RecommendationSignalRetractionReason, occurredAt: string): RecommendationSignalLedgerEventInput {
  const hash = sha256Hex(entry.sourceEventId);
  return Object.freeze({
    operation: "retract" as const,
    operationId: `${OPERATION_PREFIX}retract:${hash}`,
    sourceEventId: `${SOURCE_EVENT_PREFIX}retraction:${hash}`,
    retractsSourceEventId: entry.sourceEventId,
    occurredAt,
    reason
  });
}

function applyEvent(sourceEventId: string, signal: RecommendationInterestSignal, occurredAt: string): RecommendationSignalLedgerEventInput {
  return Object.freeze({
    operation: "apply" as const,
    operationId: `${OPERATION_PREFIX}apply:${sha256Hex(sourceEventId)}`,
    sourceEventId,
    occurredAt,
    signal
  });
}

/**
 * The library's own first-session orchestrator already leaves these out. A first-session object
 * written before `excludeSourceIds` existed ignores it, and without this check candidates from a
 * reported (deleted, hidden or sensitive) set would come back.
 *
 * This only removes. It does not call the first session again to fill the gap, because a second call
 * could repeat consent checks or source reads. Such an old object has already cut its list to `limit`
 * before this runs, so fewer than `limit` results can come back. The library's own orchestrator
 * applies `excludeSourceIds` before the cut and fills the limit.
 */
function dropExcludedSetCandidates(result: RecommendationFirstSessionResult, sourceIds: readonly string[]): RecommendationFirstSessionResult {
  if (sourceIds.length === 0) return result;
  const excluded = new Set(sourceIds);
  const kept = result.recommendations.filter((item) => !hasExcludedProvenanceSource(item.candidate, excluded));
  if (kept.length === result.recommendations.length) return result;
  return Object.freeze({
    ...result,
    recommendations: Object.freeze(kept.map((item, index) => Object.freeze({ ...item, rank: index + 1 })))
  });
}

export function createRecommendationOnboardingLifecycle(
  options: RecommendationOnboardingLifecycleOptions
): RecommendationOnboardingLifecycleWithCandidateEvents {
  if (
    !isRecord(options) || !isRecord(options.derived) || !isRecord(options.engine) ||
    typeof options.derived.process !== "function" || typeof options.derived.repair !== "function" ||
    (options.derived.invalidateCandidateState !== undefined && typeof options.derived.invalidateCandidateState !== "function") ||
    (options.engine.readEventHistory !== undefined && typeof options.engine.readEventHistory !== "function") ||
    (options.firstSession !== undefined && (!isRecord(options.firstSession) || typeof options.firstSession.execute !== "function")) ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new TypeError("Invalid recommendation onboarding lifecycle options.");
  }
  const clock = options.now ?? (() => new Date().toISOString());
  // Keyed by the engine, so every lifecycle built on one engine queues per subject in one line.
  const serializer = getSharedRecommendationKeyedSerializer(options.engine);
  const subjectLock = options.subjectLock === undefined ? undefined : normalizeRecommendationSubjectLockOptions(options.subjectLock);
  // Order is always: engine queue, then the application's lock, then the store queue. Nothing takes them the other way round.
  // The work gets a signal that aborts when the lock's hold deadline passes. Without a lock it never aborts.
  function locked<T>(subjectId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return serializer.run(subjectId, subjectLock === undefined ? () => work(NEVER_ABORTED) : () => withRecommendationSubjectLock(subjectLock, subjectId, work));
  }

  /**
   * Called between steps. Nothing new starts after the deadline, so the work winds down on its own
   * and the lock is freed as soon as the step already running finishes. The ports (engine, derived
   * state, event store) take no signal, so a step already in flight cannot be interrupted.
   */
  function checkpoint(signal: AbortSignal): void {
    if (signal.aborted) throw new RecommendationSubjectLockError("hold_exceeded");
  }

  const evidenceVerifier: NormalizedRecommendationEvidenceVerifier | undefined =
    options.evidenceVerifier === undefined ? undefined : normalizeRecommendationEvidenceVerificationOptions(options.evidenceVerifier);
  const eventStore = options.candidateEvents?.store;
  let eventLimits: RecommendationCandidateEventStoreLimits | undefined;
  if (options.candidateEvents !== undefined) {
    if (!isRecord(options.candidateEvents)) throw new TypeError("Invalid recommendation onboarding lifecycle options.");
    assertRecommendationCandidateEventStore(options.candidateEvents.store);
    eventLimits = normalizeRecommendationCandidateEventStoreLimits(options.candidateEvents);
    // With the library's own derived orchestrator, deleteSubject now clears these events by default.
    // Any other derived port ignores this, and the app wires createRecommendationCandidateEventDeletionInvalidator itself.
    registerRecommendationCandidateEventStoreForDeletion(options.derived, options.candidateEvents.store);
  }
  // Writes and deletes against the store share one queue per subject, keyed by the store object, so a
  // deletion that arrives while a report is saving waits for the save and then clears what it wrote.
  const storeQueue = eventStore === undefined ? undefined : getSharedRecommendationKeyedSerializer(eventStore);
  const eventRetry: RetryPolicyOptions = { ...CANDIDATE_EVENT_STORE_RETRY, ...options.candidateEvents?.retry };

  /** Store calls fail closed: they retry with backoff, then surface the last error. */
  function storeIo<T>(work: (store: RecommendationCandidateEventStore) => Promise<T>, signal: AbortSignal = NEVER_ABORTED): Promise<T> {
    // A conflict means the record is stale, so repeating the same save cannot help. persistEvents reloads instead.
    // Past the hold deadline nothing is retried, so a failing store does not keep the lock busy through the backoff.
    return executeWithRetry(() => work(eventStore!), { ...eventRetry, shouldRetry: ({ error }) => !signal.aborted && !(error instanceof RecommendationCandidateEventConflictError) });
  }

  async function readStoredEntries(subjectId: string, now: string) {
    return readRecommendationCandidateEventRecord(await storeIo((store) => store.load(subjectId)), subjectId, eventLimits!, now);
  }

  async function readStoredEvents(subjectId: string, now: string): Promise<readonly RecommendationCandidateLifecycleEvent[]> {
    return (await readStoredEntries(subjectId, now)).map((entry) => entry.event);
  }

  // A store that claims compare-and-set is checked once. Only a definite answer is remembered, so a
  // store that was briefly down is checked again on the next write instead of being trusted or doubted for good.
  let casCheck: Promise<boolean> | undefined;
  function storeHonorsCompareAndSet(): Promise<boolean> {
    if (eventStore!.supportsCompareAndSet !== true) return Promise.resolve(false);
    if (casCheck !== undefined) return casCheck;
    const attempt = checkRecommendationCandidateEventStoreCompareAndSet(eventStore!).then((result) => {
      if (result.status === "inconclusive") casCheck = undefined;
      return result.status === "passed";
    }, () => { casCheck = undefined; return false; });
    casCheck = attempt;
    return attempt;
  }

  /**
   * Loads, merges and saves. A store that supports compare-and-set is told which record version the
   * merge was built from, so a write from another process or device in between is noticed: the save is
   * refused, and this reloads and merges again instead of overwriting it. A store that does not
   * declare support, or declares it but fails the conformance check, is treated as single-writer:
   * writes from this process are still serialized per subject, but another process can overwrite.
   */
  async function persistEvents(subjectId: string, events: readonly RecommendationCandidateLifecycleEvent[], now: string, signal: AbortSignal): Promise<void> {
    const retry: RetryPolicyOptions = {
      ...CANDIDATE_EVENT_CONFLICT_RETRY,
      ...(eventRetry.random === undefined ? {} : { random: eventRetry.random }),
      ...(eventRetry.retrySleeper === undefined ? {} : { retrySleeper: eventRetry.retrySleeper }),
      shouldRetry: ({ error }) => !signal.aborted && error instanceof RecommendationCandidateEventConflictError
    };
    checkpoint(signal);
    const useCompareAndSet = await storeHonorsCompareAndSet();
    await storeQueue!.run(subjectId, () => executeWithRetry(async () => {
      checkpoint(signal);
      const raw = await storeIo((store) => store.load(subjectId), signal);
      const merged = mergeRecommendationCandidateEventEntries(readRecommendationCandidateEventRecord(raw, subjectId, eventLimits!, now), events, eventLimits!, now);
      if (!merged.changed) return;
      const record = buildRecommendationCandidateEventRecord(subjectId, merged.entries, now);
      checkpoint(signal);
      const expected = useCompareAndSet ? { expectedDigest: recommendationCandidateEventRecordDigest(raw) } : undefined;
      await storeIo((store) => expected === undefined ? store.save(subjectId, record) : store.save(subjectId, record, expected), signal);
    }, retry));
  }

  /** Revoked or denied consent removes what was kept. If the removal fails, the call fails with it. */
  async function clearStoredEvents(subjectId: string): Promise<void> {
    if (eventStore !== undefined) await storeIo((store) => deleteStoredRecommendationCandidateEvents(store, subjectId));
  }

  async function requireStoreConsent(subjectId: string, policy: RecommendationConsentPolicy | undefined): Promise<void> {
    if (policy === undefined) throw new TypeError("Storing recommendation candidate events requires a consent policy.");
    try {
      await requireRecommendationConsent(policy, {
        subjectId,
        dataUse: "local_personalization",
        protocol: "app_local",
        sourceVisibility: "local_only",
        accessBasis: "owner",
        containsPrivateData: true,
        containsThirdPartyData: false,
        serverSideProcessing: eventStore!.manifest.processingBoundary !== "local_only"
      });
    } catch (error) {
      if (error instanceof RecommendationConsentDeniedError) await clearStoredEvents(subjectId);
      throw error;
    }
  }

  const timestampMessage = "Invalid recommendation onboarding lifecycle timestamp.";

  /** A time given by the caller may not run ahead of the lifecycle clock by more than the allowed skew. */
  function timestamp(value: unknown): string {
    const current = normalizeStrictRfc3339Timestamp(clock(), timestampMessage);
    if (value === undefined) return current;
    const given = normalizeStrictRfc3339Timestamp(value, timestampMessage);
    assertRecommendationTimestampNotAhead(
      Date.parse(given),
      Date.parse(current),
      "Recommendation onboarding lifecycle time is too far ahead of the clock."
    );
    return given;
  }

  function historySignature(history: readonly RecommendationSignalLedgerEventInput[]): string {
    return history.map((event) => event.operationId).join("\u0000");
  }

  function readHistoryOrThrow(subjectId: string): Promise<readonly RecommendationSignalLedgerEventInput[]> {
    const read = options.engine.readEventHistory;
    if (read === undefined) throw new TypeError("This onboarding lifecycle needs an engine with readEventHistory to change selections.");
    return read.call(options.engine, subjectId);
  }

  function requireCandidateStateInvalidator(): (input: { subjectId: string; occurredAt: string }) => Promise<RecommendationDerivedStatePropagationResult> {
    const invalidate = options.derived.invalidateCandidateState;
    if (invalidate === undefined) throw new TypeError("This onboarding lifecycle needs a derived-state orchestrator with invalidateCandidateState to report candidate events.");
    return (input) => invalidate.call(options.derived, input);
  }

  async function reconcile(
    subjectId: string,
    now: string,
    desired: ReadonlyMap<string, { signal: RecommendationInterestSignal; digest: string }>,
    withdrawalReason: RecommendationSignalRetractionReason,
    signal: AbortSignal
  ): Promise<RecommendationOnboardingSelectionChangeResult> {
    return executeWithRetry(
      () => reconcileOnce(subjectId, now, desired, withdrawalReason, signal),
      {
        ...STALE_PLAN_RETRY,
        shouldRetry: ({ error }) => !signal.aborted && error instanceof StalePlanError
      }
    ).catch((error: unknown) => { throw error instanceof StalePlanError ? error.original : error; });
  }

  async function reconcileOnce(
    subjectId: string,
    now: string,
    desired: ReadonlyMap<string, { signal: RecommendationInterestSignal; digest: string }>,
    withdrawalReason: RecommendationSignalRetractionReason,
    signal: AbortSignal
  ): Promise<RecommendationOnboardingSelectionChangeResult> {
    checkpoint(signal);
    const history = await readHistoryOrThrow(subjectId);
    const view = readHistory(history, Date.parse(now));
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    let unchangedCount = 0;
    const events: RecommendationSignalLedgerEventInput[] = [];

    const hashes = [...new Set([...view.live.keys(), ...desired.keys()])].sort();
    for (const hash of hashes) {
      const live = view.live.get(hash) ?? [];
      const want = desired.get(hash);
      if (want === undefined) {
        for (const entry of live) events.push(retractEvent(entry, withdrawalReason, now));
        if (live.length > 0) removed.push(live[0]!.label);
        continue;
      }
      if (live.length === 1 && live[0]!.digest === want.digest) {
        unchangedCount += 1;
        continue;
      }
      for (const entry of live) events.push(retractEvent(entry, "corrected", now));
      const generation = view.nextGeneration.get(hash) ?? 0;
      events.push(applyEvent(sourceEventIdFor(hash, generation), want.signal, now));
      (live.length === 0 ? added : updated).push(targetLabel(want.signal));
    }

    // Always go through `process`, even with no events, so a pending invalidation from an earlier
    // crash is finished and the profile checkpoint is brought up to date.
    let processing: RecommendationDerivedStateProcessResult;
    checkpoint(signal);
    try {
      processing = await options.derived.process({ subjectId, events, now });
    } catch (error) {
      // A writer outside this queue (another process, or a direct engine call) may have touched the
      // ledger after the history was read, which shows up as a ledger conflict. If the history really
      // moved, plan again from it. Any other failure is returned as is.
      if (error instanceof TypeError) {
        const latest = await readHistoryOrThrow(subjectId);
        if (historySignature(latest) !== historySignature(history)) throw new StalePlanError(error);
      }
      throw error;
    }
    return Object.freeze({
      subjectId,
      added: Object.freeze(added.sort()),
      updated: Object.freeze(updated.sort()),
      removed: Object.freeze(removed.sort()),
      unchangedCount,
      eventCount: events.length,
      processing
    });
  }

  async function report(
    subjectId: string,
    rawEvents: readonly RecommendationCandidateLifecycleEvent[],
    now: string,
    signal: AbortSignal,
    policy?: RecommendationConsentPolicy,
    attestations?: readonly unknown[]
  ): Promise<RecommendationOnboardingCandidateReportResultWithEvidence> {
    const events = normalizeRecommendationCandidateLifecycleEvents(rawEvents, { now });
    if (events.length === 0) {
      return Object.freeze({ subjectId, ...RECOMMENDATION_EVIDENCE_UNVERIFIED, acceptedEventCount: 0, excludedCandidateIds: Object.freeze([]), propagation: undefined });
    }
    // With a store, consent comes first and events it already holds are not verified again. A replay
    // detecting verifier would reject the retry of a report whose save failed, and the held events
    // were already through it. Everything else is refused here, before storing or clearing any cache.
    // Checked up front so a missing port fails before consent is read or anything is stored.
    const invalidate = requireCandidateStateInvalidator();
    let fresh = events;
    if (eventStore !== undefined) {
      await requireStoreConsent(subjectId, policy);
      fresh = selectNewRecommendationCandidateEvents(await readStoredEntries(subjectId, now), events);
    }
    const verification = combineRecommendationEvidenceVerification(
      [await verifyRecommendationEvidence(evidenceVerifier, fresh, "lifecycle_event", subjectId, now, signal, attestations)],
      events.length - fresh.length
    );
    // Keep the facts before clearing caches. If keeping fails, nothing is claimed; a retry is safe
    // because an event that is already stored is not stored twice and not verified twice.
    if (eventStore !== undefined) await persistEvents(subjectId, events, now, signal);
    checkpoint(signal);
    const propagation = await invalidate({ subjectId, occurredAt: now });
    return Object.freeze({
      subjectId,
      ...verification,
      acceptedEventCount: events.length,
      excludedCandidateIds: listRecommendationLifecycleExcludedCandidateIds(events),
      propagation
    });
  }

  return Object.freeze({
    async applySelection(input: RecommendationOnboardingSelectionChangeInput) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation onboarding selection change.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      // A profile store would give the seed a second write path that the ledger cannot retract.
      // The type already forbids it, so this guards untyped callers.
      if ("profileStore" in input) throw new TypeError("Recommendation onboarding selection changes cannot take a profile store.");
      const { now: rawNow, ...seedInput } = input;
      const now = timestamp(rawNow);
      return locked(input.subjectId, async (signal) => {
        // The seed does the catalog, sensitivity and consent checks. Consent is enforced on every
        // call, so a policy that no longer allows personalization stops the change before any write.
        let seed;
        try {
          seed = await buildRecommendationOnboardingSignals(seedInput);
        } catch (error) {
          if (error instanceof RecommendationConsentDeniedError) await clearStoredEvents(input.subjectId);
          throw error;
        }
        const desired = new Map<string, { signal: RecommendationInterestSignal; digest: string }>();
        for (const signal of seed.signals) {
          const hash = targetHash(signal);
          if (desired.has(hash)) throw new TypeError("Recommendation onboarding selection produced a duplicate target.");
          desired.set(hash, { signal, digest: contentDigest(signal) });
        }
        return reconcile(input.subjectId, now, desired, "source_retracted", signal);
      });
    },

    async withdrawSelections(input: RecommendationOnboardingWithdrawalInput) {
      if (!isRecord(input) || typeof input.reason !== "string" || !WITHDRAWAL_REASON_SET.has(input.reason)) {
        throw new TypeError("Invalid recommendation onboarding withdrawal.");
      }
      assertValidRecommendationProfileSubjectId(input.subjectId);
      const now = timestamp(input.now);
      return locked(input.subjectId, async (signal) => {
        if (input.reason === "consent_revoked") await clearStoredEvents(input.subjectId);
        return reconcile(input.subjectId, now, new Map(), input.reason, signal);
      });
    },

    async reportCandidateEvents(input: RecommendationOnboardingCandidateReportInput) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation onboarding candidate report.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      const now = timestamp(input.now);
      const attestations = assertRecommendationEvidenceAttestationList(input.attestations);
      return locked(input.subjectId, (signal) => report(input.subjectId, input.events, now, signal, input.policy, attestations));
    },

    async listReportedCandidateEvents(input: { subjectId: string; now?: string }) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation candidate event read.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      if (eventStore === undefined) throw new TypeError("No recommendation candidate event store is configured.");
      const now = timestamp(input.now);
      return serializer.run(input.subjectId, async () => Object.freeze([...await readStoredEvents(input.subjectId, now)]));
    },

    async assessPlan(input: RecommendationOnboardingPlanAssessmentInput) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation plan assessment input.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      if (eventStore === undefined) throw new TypeError("No recommendation candidate event store is configured.");
      const now = timestamp(input.now);
      const policy: RecommendationConsentPolicy | undefined = input.policy as RecommendationConsentPolicy | undefined;
      const attestations = assertRecommendationEvidenceAttestationList(input.attestations);
      return locked(input.subjectId, async (signal) => {
        if (policy !== undefined) await requireStoreConsent(input.subjectId, policy);
        const stored = await readStoredEvents(input.subjectId, now);
        checkpoint(signal);
        return assessRecommendationCandidateActionPlanWithEvidence(input.plan, input.events ?? [], {
          now,
          subjectId: input.subjectId,
          storedEvents: stored,
          ...(attestations === undefined ? {} : { attestations }),
          ...(evidenceVerifier === undefined ? {} : { evidenceVerifier }),
          ...(input.maxEligibilityAgeMs === undefined ? {} : { maxEligibilityAgeMs: input.maxEligibilityAgeMs })
        });
      });
    },

    async refresh(input: RecommendationOnboardingRefreshInput) {
      if (options.firstSession === undefined) {
        throw new TypeError("Recommendation onboarding refresh requires a first-session orchestrator.");
      }
      if (!isRecord(input) || !isRecord(input.request)) throw new TypeError("Invalid recommendation onboarding refresh input.");
      const subjectId = input.request.subjectId;
      assertValidRecommendationProfileSubjectId(subjectId);
      const now = timestamp(input.now);
      const attestations = assertRecommendationEvidenceAttestationList(input.attestations);
      const firstSession = options.firstSession;
      return locked(subjectId, async (signal) => {
        const events = input.candidateEvents === undefined
          ? undefined
          : normalizeRecommendationCandidateLifecycleEvents(input.candidateEvents, { now });
        // Finish whatever an earlier crash left behind before deciding what to serve.
        const propagation = events === undefined || events.length === 0
          ? await options.derived.repair(subjectId)
          : (await report(subjectId, events, now, signal, input.policy, attestations)).propagation!;
        if (eventStore !== undefined && (events === undefined || events.length === 0) && input.policy !== undefined) {
          await requireStoreConsent(subjectId, input.policy);
        }
        // Stored events keep excluding after a restart. They are read after the report, so they include it.
        const known = eventStore === undefined ? (events ?? []) : [...(events ?? []), ...await readStoredEvents(subjectId, now)];
        const excluded = new Set(input.request.excludeCandidateIds ?? []);
        for (const id of listRecommendationLifecycleExcludedCandidateIds(known)) excluded.add(id);
        const excludedCandidateIds = Object.freeze([...excluded].sort());
        // Set-level events usually have no candidate ID, so those candidates are matched by the set's source ID.
        const sourceIds = new Set(input.request.excludeSourceIds ?? []);
        for (const id of listRecommendationLifecycleExcludedSetSourceIds(known)) sourceIds.add(id);
        const excludedSetSourceIds = Object.freeze([...sourceIds].sort());
        // Fail here with a clear message rather than deep in candidate generation. Dropping exclusions to fit would show withdrawn candidates again.
        if (excludedCandidateIds.length > MAX_EXCLUSION_IDS || excludedSetSourceIds.length > MAX_EXCLUSION_IDS) {
          throw new TypeError("Too many recommendation exclusions for one refresh.");
        }
        checkpoint(signal);
        const result = await firstSession.execute({
          ...input.request,
          ...firstSessionSignal(input.request.signal, signal),
          excludeCandidateIds: excludedCandidateIds,
          excludeSourceIds: excludedSetSourceIds
        });
        return Object.freeze({ result: dropExcludedSetCandidates(result, excludedSetSourceIds), excludedCandidateIds, excludedSetSourceIds, propagation });
      });
    }
  });
}
