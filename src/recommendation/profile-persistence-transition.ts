import type { RecommendationConsentPolicy, RecommendationDataUse } from "./consent.js";
import type { RecommendationInterestPrivacyBoundary } from "./interest-signal.js";
import { createRecommendationKeyedSerializer } from "./keyed-serializer.js";
import type { RecommendationProfilePersistenceAdapter, RecommendationProfileStoreRecord } from "./profile-store-persistence.js";
import {
  RecommendationProfilePersistenceError,
  deleteRecommendationProfileStoreRecordSafely,
  readRecommendationProfileStoreRecordSafely,
  writeRecommendationProfileStoreRecordSafely,
  type RecommendationProfilePersistenceReasonCode
} from "./profile-store-persistence-hardening.js";
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
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  /** Timestamp for the source deletion intent. Defaults to the current time. */
  now?: string;
  retry?: RecommendationProfilePersistenceRetryOptions;
  signal?: AbortSignal;
}

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

const defaultSleep = (milliseconds: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

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
  const sleep = retry.sleep ?? defaultSleep;
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

/**
 * Moves a subject's profile record between device-owned and user-owned storage. The order is fixed so
 * a crash at any point loses nothing: copy, verify by reading back, and only then delete the source.
 * Running it again after a failure is safe. Provider-owned and operator-owned placements are refused
 * by the target check here and again by the adapter placement policy.
 *
 * It moves the stored profile record only. The accepted event history and derived caches have their
 * own stores, which the application places and migrates.
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
  const retry = input.retry ?? {};
  if (!isRecord(retry)) throw new TypeError("Invalid recommendation profile persistence retry options.");
  const signal = input.signal;

  const readFrom = (location: RecommendationProfilePersistenceLocation) => withBackoff(() => readRecommendationProfileStoreRecordSafely(location.adapter, {
    subjectId: input.subjectId, storageTarget: location.storageTarget,
    ...(location.namespace === undefined ? {} : { namespace: location.namespace }),
    ...(location.salt === undefined ? {} : { salt: location.salt })
  }), retry, signal);

  return serializer.run(input.subjectId, async () => {
    const source = await readFrom(from);
    const existing = await readFrom(to);
    if (source === null) {
      if (existing === null) throw new RecommendationProfilePersistenceTransitionError("transition.error.source_missing");
      return Object.freeze({ outcome: "already_moved" as const, from: from.storageTarget, to: to.storageTarget });
    }

    const keepDestination = existing !== null && newer(existing, source);
    if (!keepDestination) {
      abortIf(signal);
      await withBackoff(() => writeRecommendationProfileStoreRecordSafely(to.adapter, {
        subjectId: input.subjectId,
        profile: source.profile,
        writtenAt: source.writtenAt,
        storageTarget: to.storageTarget,
        policy: input.policy,
        verifyWrite: true,
        ...(source.expiresAt === undefined ? {} : { expiresAt: source.expiresAt }),
        ...(to.namespace === undefined ? {} : { namespace: to.namespace }),
        ...(to.salt === undefined ? {} : { salt: to.salt }),
        ...(input.dataUse === undefined ? {} : { dataUse: input.dataUse }),
        ...(input.privacyBoundary === undefined ? {} : { privacyBoundary: input.privacyBoundary })
      }), retry, signal);
    }

    abortIf(signal);
    try {
      await withBackoff(() => deleteRecommendationProfileStoreRecordSafely(from.adapter, {
        intent: { subjectId: input.subjectId, requestedAt, scope: "recommendation_derived_data", targets: ["profile", "event_history"] },
        storageTarget: from.storageTarget,
        ...(from.namespace === undefined ? {} : { namespace: from.namespace }),
        ...(from.salt === undefined ? {} : { salt: from.salt })
      }), retry, signal);
    } catch (error) {
      if (error instanceof RecommendationProfilePersistenceTransitionError) throw error;
      throw new RecommendationProfilePersistenceTransitionError("transition.error.source_cleanup_pending", { cause: error });
    }
    return Object.freeze({ outcome: keepDestination ? "kept_newer_destination" as const : "moved" as const, from: from.storageTarget, to: to.storageTarget });
  });
}
