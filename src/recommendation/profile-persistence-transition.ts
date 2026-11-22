import {
  assertRecommendationCandidateEventStore,
  buildRecommendationCandidateEventRecord,
  mergeRecommendationCandidateEventEntries,
  normalizeRecommendationCandidateEventStoreLimits,
  readRecommendationCandidateEventRecord,
  recommendationCandidateEventRecordDigest,
  type RecommendationCandidateEventStore
} from "./candidate-event-store.js";
import { assertRecommendationTimestampNotAhead } from "./candidate-lifecycle.js";
import type { RecommendationConsentPolicy, RecommendationDataUse } from "./consent.js";
import { requireRecommendationConsent } from "./consent-enforcement.js";
import type { RecommendationInterestPrivacyBoundary } from "./interest-signal.js";
import { createRecommendationKeyedSerializer, getSharedRecommendationKeyedSerializer } from "./keyed-serializer.js";
import type { RecommendationProfilePersistenceAdapter, RecommendationProfileStoreRecord } from "./profile-store-persistence.js";
import {
  RecommendationProfilePersistenceError,
  deleteRecommendationProfileStoreRecordSafely,
  readRecommendationProfileStoreRecordSafely,
  writeRecommendationProfileStoreRecordSafely,
  type RecommendationProfilePersistenceReasonCode
} from "./profile-store-persistence-hardening.js";
import { relabelRecommendationProfileForTarget } from "./profile-privacy-label.js";
import { assertValidRecommendationProfileSubjectId, createRecommendationProfileSubjectKey } from "./profile-store-persistence-key.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

/** Only device-owned and user-owned placements can hold subject-level profile state. */
export const RECOMMENDATION_PROFILE_TRANSITION_TARGETS = ["local_app", "user_pod"] as const;
export type RecommendationProfileTransitionTarget = typeof RECOMMENDATION_PROFILE_TRANSITION_TARGETS[number];

export interface RecommendationProfilePersistenceLocation {
  adapter: RecommendationProfilePersistenceAdapter;
  storageTarget: RecommendationProfileTransitionTarget;
  namespace?: string;
  salt?: string;
  /**
   * The store that holds this subject's reported candidate events at this location. Events move only
   * when both locations have one; with just one side set they are left alone and the result says so.
   */
  candidateEventStore?: RecommendationCandidateEventStore;
}

export interface RecommendationProfilePersistenceRetryOptions {
  /** Total attempts per adapter call, including the first. Default 3, at most 6. */
  maxAttempts?: number;
  /** First backoff delay. Doubles each attempt with full jitter. Default 200 ms, at most 5000. */
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Returns a number in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
}

export interface RecommendationProfilePersistenceTransitionInput {
  subjectId: string;
  from: RecommendationProfilePersistenceLocation;
  to: RecommendationProfilePersistenceLocation;
  /** Required whenever the destination is a user-owned remote store. */
  policy: RecommendationConsentPolicy | null | undefined;
  dataUse?: RecommendationDataUse;
  /**
   * Leave this out. The destination decides the label: `server_allowed` for a pod, `local_only` for the
   * device. A value that does not fit the destination is refused, not replaced.
   */
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  /** Timestamp for the source deletion intent. Defaults to the current time. */
  now?: string;
  retry?: RecommendationProfilePersistenceRetryOptions;
  /**
   * Retention limits used when stored events are read and rewritten. Pass the same values the
   * lifecycle uses, otherwise longer-lived set-level exclusions could be dropped during the move.
   */
  candidateEventLimits?: { retentionMs?: number; maxEvents?: number; setExclusionRetentionMs?: number };
  signal?: AbortSignal;
}

/**
 * What happened to stored candidate events. Only present when at least one location has an event store.
 * `skipped_store_missing`: only one side has a store, so nothing was read, written or deleted there.
 */
export type RecommendationProfilePersistenceCandidateEventsOutcome = "moved" | "nothing_to_move" | "skipped_store_missing";

export type RecommendationProfilePersistenceTransitionOutcome =
  /** The profile was copied, verified, and removed from the source. */
  | "moved"
  /** The source was already empty and the destination holds the profile: an earlier run finished. */
  | "already_moved"
  /** The destination already held a newer profile, so it was kept and only the source was removed. */
  | "kept_newer_destination";

export interface RecommendationProfilePersistenceTransitionResult {
  outcome: RecommendationProfilePersistenceTransitionOutcome;
  from: RecommendationProfileTransitionTarget;
  to: RecommendationProfileTransitionTarget;
  candidateEvents?: RecommendationProfilePersistenceCandidateEventsOutcome;
}

export type RecommendationProfilePersistenceTransitionReason =
  | "transition.deny.unsupported_target"
  | "transition.deny.same_location"
  | "transition.error.source_missing"
  | "transition.error.source_cleanup_pending"
  | "transition.error.aborted";

/**
 * `source_cleanup_pending` means the destination holds a verified copy but the source could not be
 * deleted. Run the same transition again: it is idempotent and will finish the deletion.
 */
export class RecommendationProfilePersistenceTransitionError extends Error {
  readonly reason: RecommendationProfilePersistenceTransitionReason;
  constructor(reason: RecommendationProfilePersistenceTransitionReason, options?: { cause?: unknown }) {
    super("Recommendation profile persistence transition did not complete.", options);
    this.name = "RecommendationProfilePersistenceTransitionError";
    this.reason = reason;
  }
}

const TARGET_SET = new Set<string>(RECOMMENDATION_PROFILE_TRANSITION_TARGETS);
const RETRYABLE_REASONS = new Set<RecommendationProfilePersistenceReasonCode>([
  "persistence.error.adapter_read_failed",
  "persistence.error.adapter_write_failed",
  "persistence.error.adapter_delete_failed",
  "persistence.error.write_verification_failed"
]);
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 200;
const MAX_BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30_000;
const serializer = createRecommendationKeyedSerializer();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLocation(value: unknown): RecommendationProfilePersistenceLocation {
  if (!isRecord(value) || !isRecord(value.adapter)) throw new TypeError("Invalid recommendation profile persistence location.");
  if (typeof value.storageTarget !== "string" || !TARGET_SET.has(value.storageTarget)) {
    throw new RecommendationProfilePersistenceTransitionError("transition.deny.unsupported_target");
  }
  return value as unknown as RecommendationProfilePersistenceLocation;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number, message: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(message);
  return value;
}

function abortIf(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new RecommendationProfilePersistenceTransitionError("transition.error.aborted", { cause: signal.reason });
}

/** Default wait. The timer is cleared when the signal aborts so it cannot keep the process alive. */
function defaultSleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Waits out a backoff delay but gives up as soon as the signal aborts. */
async function abortableSleep(sleep: (milliseconds: number) => Promise<void>, milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return sleep(milliseconds);
  abortIf(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RecommendationProfilePersistenceTransitionError("transition.error.aborted", { cause: signal.reason }));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(milliseconds), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/** Retries only adapter and verification failures. Policy and consent denials are final on the first try. */
async function withBackoff<T>(work: () => Promise<T>, retry: RecommendationProfilePersistenceRetryOptions, signal: AbortSignal | undefined): Promise<T> {
  const maxAttempts = boundedInteger(retry.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS, "Invalid recommendation profile persistence retry attempts.");
  const baseDelay = boundedInteger(retry.baseDelayMs, DEFAULT_BASE_DELAY_MS, 1, MAX_BASE_DELAY_MS, "Invalid recommendation profile persistence retry delay.");
  const sleep = retry.sleep ?? ((milliseconds: number) => defaultSleep(milliseconds, signal));
  const random = retry.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    abortIf(signal);
    try {
      return await work();
    } catch (error) {
      const retryable = error instanceof RecommendationProfilePersistenceError && RETRYABLE_REASONS.has(error.reason);
      if (!retryable || attempt >= maxAttempts) throw error;
      const ceiling = Math.min(MAX_DELAY_MS, baseDelay * 2 ** (attempt - 1));
      await abortableSleep(sleep, Math.floor(random() * ceiling), signal);
    }
  }
}

function newer(left: RecommendationProfileStoreRecord, right: RecommendationProfileStoreRecord): boolean {
  return Date.parse(left.profile.updatedAt) > Date.parse(right.profile.updatedAt);
}

/** Store failures are mapped to fixed reasons so withBackoff can retry them and no store message leaks out. */
async function storeCall<T>(
  operation: "read" | "write" | "delete",
  reason: RecommendationProfilePersistenceReasonCode,
  target: RecommendationProfileTransitionTarget,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch {
    throw new RecommendationProfilePersistenceError(operation, reason, target);
  }
}

/** Same placement rule the profile adapters get: device-owned and local-only for the app, user-owned for the pod. */
function assertEventStoreMatchesTarget(store: RecommendationCandidateEventStore, target: RecommendationProfileTransitionTarget): void {
  assertRecommendationCandidateEventStore(store);
  const { authority, processingBoundary } = store.manifest;
  const allowed = target === "local_app"
    ? authority === "device_owned" && processingBoundary === "local_only"
    : authority === "user_owned" && processingBoundary === "server_allowed";
  if (!allowed) throw new RecommendationProfilePersistenceError("write", "persistence.deny.storage_placement_policy", target);
}

interface CandidateEventMove {
  subjectId: string;
  from: RecommendationProfilePersistenceLocation & { candidateEventStore: RecommendationCandidateEventStore };
  to: RecommendationProfilePersistenceLocation & { candidateEventStore: RecommendationCandidateEventStore };
  limits: ReturnType<typeof normalizeRecommendationCandidateEventStoreLimits>;
  now: string;
  retry: RecommendationProfilePersistenceRetryOptions;
  signal: AbortSignal | undefined;
}

/**
 * Copies a subject's stored events to the destination store, checks them by reading back, and only
 * then deletes the source. A record that fails validation stops the move before any write. Runs
 * inside both stores' own per-subject queues, so a report that is mid-save finishes first. The stores
 * are never called back into the lifecycle, which would wait on these same queues.
 */
function moveCandidateEvents(move: CandidateEventMove): Promise<RecommendationProfilePersistenceCandidateEventsOutcome> {
  const { subjectId, from, to, limits, now, retry, signal } = move;
  const fromStore = from.candidateEventStore;
  const toStore = to.candidateEventStore;
  const load = (store: RecommendationCandidateEventStore, target: RecommendationProfileTransitionTarget) =>
    storeCall("read", "persistence.error.adapter_read_failed", target, () => store.load(subjectId));
  return getSharedRecommendationKeyedSerializer(fromStore).run(subjectId, () => getSharedRecommendationKeyedSerializer(toStore).run(subjectId, async () => {
    const sourceRaw = await withBackoff(() => load(fromStore, from.storageTarget), retry, signal);
    if (sourceRaw === undefined) return "nothing_to_move" as const;
    const sourceEntries = readRecommendationCandidateEventRecord(sourceRaw, subjectId, limits, now);
    if (sourceEntries.length > 0) {
      const recordedAt = new Map(sourceEntries.map((entry) => [entry.event, entry.recordedAt] as const));
      await withBackoff(async () => {
        const destinationRaw = await load(toStore, to.storageTarget);
        const merged = mergeRecommendationCandidateEventEntries(
          readRecommendationCandidateEventRecord(destinationRaw, subjectId, limits, now),
          sourceEntries.map((entry) => entry.event), limits, now, (event) => recordedAt.get(event)
        );
        // The destination already holds everything, so an earlier run got this far.
        if (!merged.changed) return;
        const record = buildRecommendationCandidateEventRecord(subjectId, merged.entries, now);
        const expectedDigest = recommendationCandidateEventRecordDigest(destinationRaw);
        await storeCall("write", "persistence.error.adapter_write_failed", to.storageTarget, () => toStore.supportsCompareAndSet === true
          ? toStore.save(subjectId, record, { expectedDigest })
          : toStore.save(subjectId, record));
        const readBack = await load(toStore, to.storageTarget);
        let verified = false;
        try {
          readRecommendationCandidateEventRecord(readBack, subjectId, limits, now);
          verified = recommendationCandidateEventRecordDigest(readBack) === record.digest;
        } catch { /* a record that does not validate is a failed write, handled below */ }
        if (!verified) throw new RecommendationProfilePersistenceError("write", "persistence.error.write_verification_failed", to.storageTarget);
      }, retry, signal);
    }
    abortIf(signal);
    try {
      await withBackoff(() => storeCall("delete", "persistence.error.adapter_delete_failed", from.storageTarget, () => fromStore.delete(subjectId)), retry, signal);
    } catch (error) {
      if (error instanceof RecommendationProfilePersistenceTransitionError) throw error;
      throw new RecommendationProfilePersistenceTransitionError("transition.error.source_cleanup_pending", { cause: error });
    }
    return "moved" as const;
  }));
}

/**
 * Moves a subject's profile record between device-owned and user-owned storage. The order is fixed so
 * a crash at any point loses nothing: copy, verify by reading back, and only then delete the source.
 * Running it again after a failure is safe.
 *
 * The interests change label with the move, because the label says where they are processed. Going to
 * the pod, `local_only` becomes `server_allowed`, and that needs the user's server-side consent. Coming
 * back, `server_allowed` becomes `local_only`. Each store only ever holds its own label: the copy is
 * relabelled before it is written, and the source keeps its own label until it is deleted. A
 * destination that is already in place with the wrong label is relabelled in place, so rerunning after
 * a crash repairs it. Candidate events carry no label, so they move as they are, into a store that
 * has to match the destination placement. Provider-owned and operator-owned placements are refused
 * by the target check here and again by the adapter placement policy.
 *
 * Stored candidate events move too when both locations carry a `candidateEventStore`: they are merged
 * into the destination (keeping their original recording times), read back, and deleted from the
 * source before the source profile is removed. Derived caches and the accepted event history have
 * their own stores, which the application places and migrates.
 */
export async function transitionRecommendationProfilePersistence(
  input: RecommendationProfilePersistenceTransitionInput
): Promise<RecommendationProfilePersistenceTransitionResult> {
  if (!isRecord(input)) throw new TypeError("Invalid recommendation profile persistence transition input.");
  assertValidRecommendationProfileSubjectId(input.subjectId);
  const from = normalizeLocation(input.from);
  const to = normalizeLocation(input.to);
  if (from.storageTarget === to.storageTarget) throw new RecommendationProfilePersistenceTransitionError("transition.deny.same_location");
  const fromKey = createRecommendationProfileSubjectKey({ subjectId: input.subjectId, ...(from.namespace === undefined ? {} : { namespace: from.namespace }), ...(from.salt === undefined ? {} : { salt: from.salt }) });
  const toKey = createRecommendationProfileSubjectKey({ subjectId: input.subjectId, ...(to.namespace === undefined ? {} : { namespace: to.namespace }), ...(to.salt === undefined ? {} : { salt: to.salt }) });
  // Writing and then deleting one record would destroy it.
  if (from.adapter === to.adapter && fromKey === toKey) throw new RecommendationProfilePersistenceTransitionError("transition.deny.same_location");
  const requestedAt = normalizeStrictRfc3339Timestamp(input.now ?? new Date().toISOString(), "Invalid recommendation profile persistence transition timestamp.");
  assertRecommendationTimestampNotAhead(Date.parse(requestedAt), Date.now(), "Recommendation profile persistence transition time is too far ahead of the clock.");
  const retry = input.retry ?? {};
  if (!isRecord(retry)) throw new TypeError("Invalid recommendation profile persistence retry options.");
  const signal = input.signal;
  const limits = normalizeRecommendationCandidateEventStoreLimits(input.candidateEventLimits);
  const fromEvents = from.candidateEventStore;
  const toEvents = to.candidateEventStore;
  const movesEvents = fromEvents !== undefined && toEvents !== undefined;
  if (movesEvents) {
    assertEventStoreMatchesTarget(fromEvents, from.storageTarget);
    assertEventStoreMatchesTarget(toEvents, to.storageTarget);
    // Both sides queue on their store, so one store on both sides would wait on itself.
    if (fromEvents === toEvents) throw new RecommendationProfilePersistenceTransitionError("transition.deny.same_location");
  } else if (fromEvents !== undefined) assertEventStoreMatchesTarget(fromEvents, from.storageTarget);
  else if (toEvents !== undefined) assertEventStoreMatchesTarget(toEvents, to.storageTarget);
  const moveEvents = async (): Promise<{ candidateEvents?: RecommendationProfilePersistenceCandidateEventsOutcome }> => {
    if (fromEvents === undefined && toEvents === undefined) return {};
    if (!movesEvents) return { candidateEvents: "skipped_store_missing" };
    abortIf(signal);
    return { candidateEvents: await moveCandidateEvents({ subjectId: input.subjectId, from: { ...from, candidateEventStore: fromEvents }, to: { ...to, candidateEventStore: toEvents }, limits, now: requestedAt, retry, signal }) };
  };

  const readFrom = (location: RecommendationProfilePersistenceLocation) => withBackoff(() => readRecommendationProfileStoreRecordSafely(location.adapter, {
    subjectId: input.subjectId, storageTarget: location.storageTarget,
    ...(location.namespace === undefined ? {} : { namespace: location.namespace }),
    ...(location.salt === undefined ? {} : { salt: location.salt })
  }), retry, signal);

  return serializer.run(input.subjectId, async () => {
    // Events are subject-level private data too, so a remote destination needs the same consent as the profile.
    // It is checked up front, so a denial leaves both the profile and the events where they were.
    if (movesEvents && to.storageTarget === "user_pod") {
      if (input.policy === undefined || input.policy === null) throw new RecommendationProfilePersistenceError("write", "persistence.deny.server_consent_required", to.storageTarget);
      await requireRecommendationConsent(input.policy, Object.freeze({
        subjectId: input.subjectId,
        dataUse: input.dataUse ?? "local_personalization",
        protocol: "app_local",
        sourceVisibility: "local_only",
        accessBasis: "owner",
        containsPrivateData: true,
        containsThirdPartyData: false,
        serverSideProcessing: true
      }));
    }
    const source = await readFrom(from);
    const existing = await readFrom(to);
    // The destination's label comes from where it sits. This writes a record to the destination with
    // that label, verified by reading it back. The pod write relabels again, which changes nothing.
    const writeLabelled = (record: RecommendationProfileStoreRecord) => withBackoff(() => writeRecommendationProfileStoreRecordSafely(to.adapter, {
      subjectId: input.subjectId,
      profile: relabelRecommendationProfileForTarget(record.profile, to.storageTarget),
      writtenAt: record.writtenAt,
      storageTarget: to.storageTarget,
      policy: input.policy,
      verifyWrite: true,
      ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
      ...(to.namespace === undefined ? {} : { namespace: to.namespace }),
      ...(to.salt === undefined ? {} : { salt: to.salt }),
      ...(input.dataUse === undefined ? {} : { dataUse: input.dataUse }),
      ...(input.privacyBoundary === undefined ? {} : { privacyBoundary: input.privacyBoundary })
    }), retry, signal);
    // A destination that is already in place but carries the other side's label (a pod record written as
    // local_only by an older release, or a device record that kept server_allowed) is fixed in place.
    const healDestination = async (): Promise<void> => {
      if (existing === null || relabelRecommendationProfileForTarget(existing.profile, to.storageTarget) === existing.profile) return;
      abortIf(signal);
      await writeLabelled(existing);
    };
    if (source === null) {
      if (existing === null) throw new RecommendationProfilePersistenceTransitionError("transition.error.source_missing");
      await healDestination();
      const events = await moveEvents();
      return Object.freeze({ outcome: "already_moved" as const, from: from.storageTarget, to: to.storageTarget, ...events });
    }

    const keepDestination = existing !== null && newer(existing, source);
    if (keepDestination) {
      await healDestination();
    } else {
      abortIf(signal);
      await writeLabelled(source);
    }

    // Events go before the source profile is deleted, so a failure here leaves the profile as the retry marker.
    const events = await moveEvents();
    abortIf(signal);
    try {
      await withBackoff(() => deleteRecommendationProfileStoreRecordSafely(from.adapter, {
        intent: { subjectId: input.subjectId, requestedAt, scope: "recommendation_derived_data", targets: ["profile"] },
        storageTarget: from.storageTarget,
        ...(from.namespace === undefined ? {} : { namespace: from.namespace }),
        ...(from.salt === undefined ? {} : { salt: from.salt })
      }), retry, signal);
    } catch (error) {
      if (error instanceof RecommendationProfilePersistenceTransitionError) throw error;
      throw new RecommendationProfilePersistenceTransitionError("transition.error.source_cleanup_pending", { cause: error });
    }
    return Object.freeze({ outcome: keepDestination ? "kept_newer_destination" as const : "moved" as const, from: from.storageTarget, to: to.storageTarget, ...events });
  });
}
