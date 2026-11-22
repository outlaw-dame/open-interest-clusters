/**
 * A hook for a lock the application owns, so writes for one subject can be kept apart across
 * processes or devices. The library only calls it. It has no lease, no expiry and no clock beyond a
 * bounded wait, and it does not pretend to lock anything by itself.
 */

/** Frees the lock. May return a promise. Called at most once. */
export type RecommendationSubjectLockRelease = () => void | Promise<void>;

export interface RecommendationSubjectLock {
  /**
   * Resolves once the caller holds the lock for `subjectId`, with the function that frees it. Reject
   * (or throw) when the lock cannot be had. Stop waiting when `signal` aborts: that happens on
   * timeout and when the lifecycle's own `signal` aborts. If the lock is granted after that, the
   * library frees it again straight away.
   */
  acquire(subjectId: string, options: { signal: AbortSignal }): Promise<RecommendationSubjectLockRelease>;
}

export interface RecommendationSubjectLockOptions extends RecommendationSubjectLock {
  /** Longest wait for `acquire`, and for a release. Default 5000 ms, at most 60000 ms. */
  timeoutMs?: number;
  /** Aborting this stops every wait for the lock, for example at shutdown. */
  signal?: AbortSignal;
  /**
   * Told when a release fails or hangs. A failing release never changes the result or error of the
   * write it followed, so this is the only place the failure shows up. Errors thrown here are ignored.
   */
  onReleaseError?: (error: RecommendationSubjectLockError) => void;
  /**
   * Longest time the work may run while the lock is held. Default 60000 ms, at most 300000 ms. When it
   * passes, the signal given to the work aborts, `onHoldExceeded` is told, and the lock is still kept
   * until the work has actually stopped. Only then is the call failed with `hold_exceeded`. The lock is
   * never released at the deadline, because that would let a second writer start while a write is
   * still in flight.
   */
  maxHoldMs?: number;
  /**
   * Told once when the hold deadline passes, before the work has necessarily stopped. If the work
   * ignores the abort and never settles, the lock stays held and this is the only signal the app gets,
   * so use it to alert or to ask the user to reload. Errors it throws are ignored.
   */
  onHoldExceeded?: (error: RecommendationSubjectLockError) => void;
}

export const RECOMMENDATION_SUBJECT_LOCK_DEFAULT_TIMEOUT_MS = 5_000;
export const RECOMMENDATION_SUBJECT_LOCK_MAX_TIMEOUT_MS = 60_000;
export const RECOMMENDATION_SUBJECT_LOCK_DEFAULT_HOLD_MS = 60_000;
export const RECOMMENDATION_SUBJECT_LOCK_MAX_HOLD_MS = 300_000;

export type RecommendationSubjectLockFailureReason =
  | "acquire_failed"
  | "acquire_timeout"
  | "aborted"
  | "hold_exceeded"
  | "invalid_release"
  | "release_failed"
  | "release_timeout";

/**
 * Raised when the lock could not be had, or when the work ran past `maxHoldMs` (`hold_exceeded`). In the
 * first case nothing was written. In the second the work was told to stop and has settled, but part of
 * it may have been written, so read the state again before retrying. The message never contains the subject ID.
 */
export class RecommendationSubjectLockError extends Error {
  readonly reason: RecommendationSubjectLockFailureReason;
  constructor(reason: RecommendationSubjectLockFailureReason, cause?: unknown) {
    super(`Recommendation subject lock failed: ${reason}.`, cause === undefined ? undefined : { cause });
    this.name = "RecommendationSubjectLockError";
    this.reason = reason;
  }
}

export interface NormalizedRecommendationSubjectLock {
  readonly acquire: RecommendationSubjectLock["acquire"];
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly onReleaseError: ((error: RecommendationSubjectLockError) => void) | undefined;
  readonly maxHoldMs: number;
  readonly onHoldExceeded: ((error: RecommendationSubjectLockError) => void) | undefined;
}

export function normalizeRecommendationSubjectLockOptions(input: unknown): NormalizedRecommendationSubjectLock {
  const invalid = () => new TypeError("Invalid recommendation subject lock options.");
  if (typeof input !== "object" || input === null) throw invalid();
  const { acquire, timeoutMs, signal, onReleaseError, maxHoldMs, onHoldExceeded } = input as Partial<RecommendationSubjectLockOptions>;
  if (typeof acquire !== "function") throw invalid();
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RECOMMENDATION_SUBJECT_LOCK_MAX_TIMEOUT_MS)) throw invalid();
  if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof signal.addEventListener !== "function" || typeof signal.aborted !== "boolean")) throw invalid();
  if (onReleaseError !== undefined && typeof onReleaseError !== "function") throw invalid();
  if (maxHoldMs !== undefined && (!Number.isInteger(maxHoldMs) || maxHoldMs < 1 || maxHoldMs > RECOMMENDATION_SUBJECT_LOCK_MAX_HOLD_MS)) throw invalid();
  if (onHoldExceeded !== undefined && typeof onHoldExceeded !== "function") throw invalid();
  return Object.freeze({
    acquire: (subjectId: string, options: { signal: AbortSignal }) => acquire.call(input, subjectId, options),
    timeoutMs: timeoutMs ?? RECOMMENDATION_SUBJECT_LOCK_DEFAULT_TIMEOUT_MS,
    signal,
    onReleaseError,
    maxHoldMs: maxHoldMs ?? RECOMMENDATION_SUBJECT_LOCK_DEFAULT_HOLD_MS,
    onHoldExceeded
  });
}

function reportReleaseFailure(lock: NormalizedRecommendationSubjectLock, reason: "release_failed" | "release_timeout", cause?: unknown): void {
  try { lock.onReleaseError?.(new RecommendationSubjectLockError(reason, cause)); } catch { /* a broken reporter must not change the outcome */ }
}

/** Runs the release once, bounded, and never throws. */
function makeRelease(lock: NormalizedRecommendationSubjectLock, release: RecommendationSubjectLockRelease): () => Promise<void> {
  let called = false;
  return async () => {
    if (called) return;
    called = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), lock.timeoutMs); });
      const outcome = await Promise.race([Promise.resolve().then(release).then(() => "done" as const), timedOut]);
      if (outcome === "timeout") reportReleaseFailure(lock, "release_timeout");
    } catch (error) {
      reportReleaseFailure(lock, "release_failed", error);
    } finally {
      clearTimeout(timer);
    }
  };
}

function acquireLock(lock: NormalizedRecommendationSubjectLock, subjectId: string): Promise<() => Promise<void>> {
  if (lock.signal?.aborted === true) return Promise.reject(new RecommendationSubjectLockError("aborted"));
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => fail("aborted");
    const cleanup = () => { clearTimeout(timer); lock.signal?.removeEventListener("abort", onAbort); };
    function fail(reason: RecommendationSubjectLockFailureReason, cause?: unknown): void {
      if (done) return;
      done = true;
      cleanup();
      controller.abort();
      reject(new RecommendationSubjectLockError(reason, cause));
    }
    timer = setTimeout(() => fail("acquire_timeout"), lock.timeoutMs);
    lock.signal?.addEventListener("abort", onAbort, { once: true });
    let pending: Promise<RecommendationSubjectLockRelease>;
    try {
      pending = Promise.resolve(lock.acquire(subjectId, { signal: controller.signal }));
    } catch (error) {
      fail("acquire_failed", error);
      return;
    }
    pending.then((release) => {
      if (typeof release !== "function") { fail("invalid_release"); return; }
      if (done) {
        // Granted after we stopped waiting. Nobody will use it, so give it straight back.
        void makeRelease(lock, release)();
        return;
      }
      done = true;
      cleanup();
      resolve(makeRelease(lock, release));
    }, (error: unknown) => fail("acquire_failed", error));
  });
}

function reportHoldExceeded(lock: NormalizedRecommendationSubjectLock): void {
  try {
    const told: unknown = lock.onHoldExceeded?.(new RecommendationSubjectLockError("hold_exceeded"));
    // An async callback that rejects must not become an unhandled rejection either.
    if (typeof (told as { then?: unknown } | undefined)?.then === "function") (told as Promise<unknown>).then(undefined, () => undefined);
  } catch { /* a broken reporter must not change the outcome */ }
}

/**
 * Holds the lock around `work`. Callers queue per subject first and take this lock second, never the
 * reverse, so a lock holder is never waiting on the in-process queue. A failed acquire rejects
 * before `work` runs. The lock is released in a `finally`, and a failing release never replaces the
 * result or error of `work`.
 *
 * `work` gets a signal that aborts after `maxHoldMs`. Passing the deadline does not release anything:
 * the lock (and the queues around it, which are held by the same promise) stay held until `work`
 * settles, and then the call fails with `hold_exceeded`, whatever `work` returned or threw. If `work`
 * never settles, the lock is never released by the library. A Web Lock goes when the tab closes.
 */
export async function withRecommendationSubjectLock<T>(
  lock: NormalizedRecommendationSubjectLock,
  subjectId: string,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const release = await acquireLock(lock, subjectId);
  const controller = new AbortController();
  let exceeded = false;
  const timer = setTimeout(() => {
    exceeded = true;
    controller.abort();
    reportHoldExceeded(lock);
  }, lock.maxHoldMs);
  try {
    const result = await work(controller.signal);
    if (exceeded) throw new RecommendationSubjectLockError("hold_exceeded");
    return result;
  } catch (error) {
    // The work's own error is dropped on purpose: after an abort it is usually an AbortError, and it may name the subject.
    if (exceeded) throw new RecommendationSubjectLockError("hold_exceeded");
    throw error;
  } finally {
    clearTimeout(timer);
    await release();
  }
}
