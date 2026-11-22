import { hasUnsafeControlCharacter } from "./control-characters.js";

/**
 * Candidate lifecycle events, starter-pack consent and curated-set provenance all come from the
 * caller and carry no proof. This module is the one place an application can plug in a check
 * that they are real. Nothing in the library verifies protocol proofs (commit or label signatures,
 * HTTP signatures, ACLs) yet, so by default nothing is verified and every result says so.
 */
export const RECOMMENDATION_EVIDENCE_KINDS = ["lifecycle_event", "starter_pack_consent", "starter_pack_provenance"] as const;
export type RecommendationEvidenceKind = typeof RECOMMENDATION_EVIDENCE_KINDS[number];

export const DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS = 5_000;
export const MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS = 30_000;
export const DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_CONCURRENCY = 4;
export const MAX_RECOMMENDATION_EVIDENCE_VERIFIER_CONCURRENCY = 16;
export const DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TOTAL_TIMEOUT_MS = 30_000;
export const MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TOTAL_TIMEOUT_MS = 120_000;
const MAX_VERIFIER_ID_LENGTH = 128;

export interface RecommendationEvidenceVerifierContext {
  /** The subject the evidence is being used for. Bind to it so evidence for one subject cannot be reused for another. */
  readonly subjectId: string;
  readonly kind: RecommendationEvidenceKind;
  /** The caller's clock for this operation. Use it for expiry checks. */
  readonly now: string;
  /** Aborted when the verifier runs past its time limit, or when another item in the same call fails. Stop any work that honors it. */
  readonly signal: AbortSignal;
}

/**
 * Implemented by the application. Return exactly `{ verified: true }` to accept. Anything else,
 * including `{ verified: false }`, a thrown error, a timeout or a malformed value, rejects the evidence.
 * Replay detection (nonce or event ID seen before) belongs here too, because only the verifier knows
 * what its signatures cover.
 */
export interface RecommendationEvidenceVerifier {
  /** Short stable name that is reported next to a verified result, such as the name of the check it performs. */
  readonly id: string;
  verify(evidence: unknown, context: RecommendationEvidenceVerifierContext): Promise<{ verified: boolean }> | { verified: boolean };
}

export interface RecommendationEvidenceVerifierOptions {
  verifier: RecommendationEvidenceVerifier;
  /** Per-item time limit. Default 5 seconds, at most 30. */
  timeoutMs?: number;
  /** How many items are checked at once within one call. Default 4, at most 16. */
  maxConcurrency?: number;
  /**
   * Time limit for all items of one kind in one call. Default 30 seconds, at most 120. Calls hold the
   * subject's queue while they verify, so this is the longest a verifier can keep other work waiting
   * per kind. Running out counts as a `timeout` failure.
   */
  totalTimeoutMs?: number;
}

/**
 * - `verified`: a verifier accepted every item this call used, and at least one item was checked.
 * - `partial`: a verifier accepted what it was asked about, but some events this call used were not
 *   checked (stored events, or events that were already stored). See `storedEventsNotChecked`.
 * - `unverified`: nothing was checked, so the evidence is exactly as trustworthy as whoever supplied it.
 */
export type RecommendationEvidenceVerificationState = "verified" | "partial" | "unverified";

export interface RecommendationEvidenceVerification {
  readonly evidenceVerification: RecommendationEvidenceVerificationState;
  readonly verifierId?: string;
  /** Which kinds of evidence a verifier accepted in this call. Empty when nothing was checked. */
  readonly verifiedKinds: readonly RecommendationEvidenceKind[];
  /** Events this call relied on that were not checked here because they came from the event store. */
  readonly storedEventsNotChecked: number;
}

export const RECOMMENDATION_EVIDENCE_UNVERIFIED: RecommendationEvidenceVerification = Object.freeze({
  evidenceVerification: "unverified",
  verifiedKinds: Object.freeze([]),
  storedEventsNotChecked: 0
});

export type RecommendationEvidenceVerificationFailure = "rejected" | "error" | "timeout" | "malformed";

/** Thrown when a configured verifier does not accept the evidence. The caller must not use the evidence. */
export class RecommendationEvidenceVerificationError extends Error {
  constructor(readonly kind: RecommendationEvidenceKind, readonly failure: RecommendationEvidenceVerificationFailure, options?: { cause?: unknown }) {
    super(`Recommendation evidence verification failed (${kind}: ${failure}).`, options);
    this.name = "RecommendationEvidenceVerificationError";
  }
}

export interface NormalizedRecommendationEvidenceVerifier {
  readonly verifier: RecommendationEvidenceVerifier;
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly totalTimeoutMs: number;
}

export function normalizeRecommendationEvidenceVerifierOptions(options: unknown): NormalizedRecommendationEvidenceVerifier {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Invalid recommendation evidence verifier options.");
  const { verifier, timeoutMs, maxConcurrency, totalTimeoutMs } = options as Partial<RecommendationEvidenceVerifierOptions>;
  if (
    verifier === null || typeof verifier !== "object" || typeof verifier.verify !== "function" || typeof verifier.id !== "string" ||
    verifier.id.length === 0 || verifier.id.length > MAX_VERIFIER_ID_LENGTH || verifier.id.trim() !== verifier.id || hasUnsafeControlCharacter(verifier.id)
  ) {
    throw new TypeError("Invalid recommendation evidence verifier.");
  }
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS)) {
    throw new TypeError("Invalid recommendation evidence verifier timeout.");
  }
  if (maxConcurrency !== undefined && (typeof maxConcurrency !== "number" || !Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > MAX_RECOMMENDATION_EVIDENCE_VERIFIER_CONCURRENCY)) {
    throw new TypeError("Invalid recommendation evidence verifier concurrency.");
  }
  if (totalTimeoutMs !== undefined && (typeof totalTimeoutMs !== "number" || !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TOTAL_TIMEOUT_MS)) {
    throw new TypeError("Invalid recommendation evidence verifier total timeout.");
  }
  return Object.freeze({
    verifier,
    timeoutMs: timeoutMs ?? DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS,
    maxConcurrency: maxConcurrency ?? DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_CONCURRENCY,
    totalTimeoutMs: totalTimeoutMs ?? DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TOTAL_TIMEOUT_MS
  });
}

/** Asks the verifier about one item. Resolves only on an explicit `{ verified: true }`; every other outcome throws. */
async function verifyOne(
  configured: NormalizedRecommendationEvidenceVerifier,
  evidence: unknown,
  kind: RecommendationEvidenceKind,
  subjectId: string,
  now: string,
  timeoutMs: number,
  callSignal: AbortSignal
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCallAbort: () => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => {
    // The call as a whole failing aborts this item too, so a sibling does not keep running unobserved.
    // Stop waiting as well, so a verifier that ignores its signal does not hold this item open.
    onCallAbort = () => {
      controller.abort();
      reject(new RecommendationEvidenceVerificationError(kind, "error"));
    };
    if (callSignal.aborted) onCallAbort();
    else callSignal.addEventListener("abort", onCallAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new RecommendationEvidenceVerificationError(kind, "timeout"));
    }, timeoutMs);
  });
  let result: unknown;
  try {
    const call = (async () => configured.verifier.verify(evidence, Object.freeze({ subjectId, kind, now, signal: controller.signal })))();
    // If the timeout wins, a later failure of the verifier call must not surface as unhandled.
    call.catch(() => undefined);
    result = await Promise.race([call, timeout]);
  } catch (error) {
    if (error instanceof RecommendationEvidenceVerificationError) throw error;
    throw new RecommendationEvidenceVerificationError(kind, "error", { cause: error });
  } finally {
    clearTimeout(timer);
    callSignal.removeEventListener("abort", onCallAbort);
  }
  if (result === null || typeof result !== "object" || Array.isArray(result) || typeof (result as { verified?: unknown }).verified !== "boolean") {
    throw new RecommendationEvidenceVerificationError(kind, "malformed");
  }
  if ((result as { verified: boolean }).verified !== true) throw new RecommendationEvidenceVerificationError(kind, "rejected");
}

/**
 * Verifies the items with bounded concurrency and an overall deadline, and stops handing out work
 * after the first failure. The first failure also aborts the `signal` of every verifier call still
 * running, so nothing keeps working after the caller has the error. With no verifier the items are
 * left alone and the result says `unverified`. With a verifier and nothing to check it also says `unverified`, because no check
 * ran. A verifier can only reject; it never widens what evidence may do.
 */
export async function verifyRecommendationEvidence(
  configured: NormalizedRecommendationEvidenceVerifier | undefined,
  items: readonly unknown[],
  kind: RecommendationEvidenceKind,
  subjectId: string,
  now: string
): Promise<RecommendationEvidenceVerification> {
  if (configured === undefined || items.length === 0) return RECOMMENDATION_EVIDENCE_UNVERIFIED;
  const deadline = Date.now() + configured.totalTimeoutMs;
  let next = 0;
  let failed = false;
  const callController = new AbortController();
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++];
      const remaining = deadline - Date.now();
      try {
        if (remaining <= 0) throw new RecommendationEvidenceVerificationError(kind, "timeout");
        await verifyOne(configured, item, kind, subjectId, now, Math.min(configured.timeoutMs, remaining), callController.signal);
      } catch (error) {
        failed = true;
        callController.abort();
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(configured.maxConcurrency, items.length) }, worker));
  return Object.freeze({
    evidenceVerification: "verified" as const,
    verifierId: configured.verifier.id,
    verifiedKinds: Object.freeze([kind]),
    storedEventsNotChecked: 0
  });
}

/**
 * Failures throw, so every kind listed in the result passed. The state is `verified` when something
 * was checked and no stored events were relied on unchecked, `partial` when something was checked but
 * stored events were left out, and `unverified` when nothing was checked.
 */
export function combineRecommendationEvidenceVerification(
  results: readonly RecommendationEvidenceVerification[],
  storedEventsNotChecked = 0
): RecommendationEvidenceVerification {
  const checked = results.filter((result) => result.evidenceVerification !== "unverified");
  if (checked.length === 0) return Object.freeze({ ...RECOMMENDATION_EVIDENCE_UNVERIFIED, storedEventsNotChecked });
  const kinds = RECOMMENDATION_EVIDENCE_KINDS.filter((kind) => checked.some((result) => result.verifiedKinds.includes(kind)));
  return Object.freeze({
    evidenceVerification: storedEventsNotChecked > 0 ? "partial" as const : "verified" as const,
    verifierId: checked[0]!.verifierId!,
    verifiedKinds: Object.freeze(kinds),
    storedEventsNotChecked
  });
}
