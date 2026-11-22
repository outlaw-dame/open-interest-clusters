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
}

export const RECOMMENDATION_SUBJECT_LOCK_DEFAULT_TIMEOUT_MS = 5_000;
export const RECOMMENDATION_SUBJECT_LOCK_MAX_TIMEOUT_MS = 60_000;

export type RecommendationSubjectLockFailureReason =
  | "acquire_failed"
  | "acquire_timeout"
  | "aborted"
  | "invalid_release"
  | "release_failed"
  | "release_timeout";

/** Raised when the lock could not be had. Nothing was written. The message never contains the subject ID. */
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
}

export function normalizeRecommendationSubjectLockOptions(input: unknown): NormalizedRecommendationSubjectLock {
  const invalid = () => new TypeError("Invalid recommendation subject lock options.");
  if (typeof input !== "object" || input === null) throw invalid();
  const { acquire, timeoutMs, signal, onReleaseError } = input as Partial<RecommendationSubjectLockOptions>;
  if (typeof acquire !== "function") throw invalid();
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RECOMMENDATION_SUBJECT_LOCK_MAX_TIMEOUT_MS)) throw invalid();
  if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof signal.addEventListener !== "function" || typeof signal.aborted !== "boolean")) throw invalid();
  if (onReleaseError !== undefined && typeof onReleaseError !== "function") throw invalid();
  return Object.freeze({
    acquire: (subjectId: string, options: { signal: AbortSignal }) => acquire.call(input, subjectId, options),
    timeoutMs: timeoutMs ?? RECOMMENDATION_SUBJECT_LOCK_DEFAULT_TIMEOUT_MS,
    signal,
    onReleaseError
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

/**
 * Holds the lock around `work`. Callers queue per subject first and take this lock second, never the
 * reverse, so a lock holder is never waiting on the in-process queue. A failed acquire rejects
 * before `work` runs. The lock is released in a `finally`, and a failing release never replaces the
 * result or error of `work`.
 */
export async function withRecommendationSubjectLock<T>(
  lock: NormalizedRecommendationSubjectLock,
  subjectId: string,
  work: () => Promise<T>
): Promise<T> {
  const release = await acquireLock(lock, subjectId);
  try {
    return await work();
  } finally {
    await release();
  }
}
