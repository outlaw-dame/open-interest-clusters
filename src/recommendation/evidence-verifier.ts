import { hasUnsafeControlCharacter } from "./control-characters.js";

/**
 * Candidate lifecycle events, starter-pack consent and curated-set provenance all come from the
 * caller and carry no signature. This module is the one place an application can plug in a check
 * that they are real. The library ships no keys and no trust root, so by default nothing is verified
 * and every result says so.
 */
export const RECOMMENDATION_EVIDENCE_KINDS = ["lifecycle_event", "starter_pack_consent", "starter_pack_provenance"] as const;
export type RecommendationEvidenceKind = typeof RECOMMENDATION_EVIDENCE_KINDS[number];

export const DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS = 5_000;
export const MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS = 30_000;
const MAX_VERIFIER_ID_LENGTH = 128;

export interface RecommendationEvidenceVerifierContext {
  /** The subject the evidence is being used for. Bind to it so evidence for one subject cannot be reused for another. */
  readonly subjectId: string;
  readonly kind: RecommendationEvidenceKind;
  /** The caller's clock for this operation. Use it for expiry checks. */
  readonly now: string;
  /** Aborted when the verifier runs past its time limit. Stop any work that honors it. */
  readonly signal: AbortSignal;
}

/**
 * Implemented by the application. Return exactly `{ verified: true }` to accept. Anything else,
 * including `{ verified: false }`, a thrown error, a timeout or a malformed value, rejects the evidence.
 * Replay detection (nonce or event ID seen before) belongs here too, because only the verifier knows
 * what its signatures cover.
 */
export interface RecommendationEvidenceVerifier {
  /** Short stable name that is reported next to a verified result, such as a key set identifier. */
  readonly id: string;
  verify(evidence: unknown, context: RecommendationEvidenceVerifierContext): Promise<{ verified: boolean }> | { verified: boolean };
}

export interface RecommendationEvidenceVerifierOptions {
  verifier: RecommendationEvidenceVerifier;
  /** Per-item time limit. Default 5 seconds, at most 30. */
  timeoutMs?: number;
}

/**
 * `verified` means a configured verifier accepted every item it was asked about. `unverified` means no
 * verifier ran, so the evidence is exactly as trustworthy as the caller that supplied it.
 */
export type RecommendationEvidenceVerificationState = "verified" | "unverified";

export interface RecommendationEvidenceVerification {
  readonly evidenceVerification: RecommendationEvidenceVerificationState;
  readonly verifierId?: string;
}

export const RECOMMENDATION_EVIDENCE_UNVERIFIED: RecommendationEvidenceVerification = Object.freeze({ evidenceVerification: "unverified" });

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
}

export function normalizeRecommendationEvidenceVerifierOptions(options: unknown): NormalizedRecommendationEvidenceVerifier {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Invalid recommendation evidence verifier options.");
  const { verifier, timeoutMs } = options as Partial<RecommendationEvidenceVerifierOptions>;
  if (
    verifier === null || typeof verifier !== "object" || typeof verifier.verify !== "function" || typeof verifier.id !== "string" ||
    verifier.id.length === 0 || verifier.id.length > MAX_VERIFIER_ID_LENGTH || verifier.id.trim() !== verifier.id || hasUnsafeControlCharacter(verifier.id)
  ) {
    throw new TypeError("Invalid recommendation evidence verifier.");
  }
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS)) {
    throw new TypeError("Invalid recommendation evidence verifier timeout.");
  }
  return Object.freeze({ verifier, timeoutMs: timeoutMs ?? DEFAULT_RECOMMENDATION_EVIDENCE_VERIFIER_TIMEOUT_MS });
}

/** Asks the verifier about one item. Resolves only on an explicit `{ verified: true }`; every other outcome throws. */
async function verifyOne(
  configured: NormalizedRecommendationEvidenceVerifier,
  evidence: unknown,
  kind: RecommendationEvidenceKind,
  subjectId: string,
  now: string
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RecommendationEvidenceVerificationError(kind, "timeout"));
    }, configured.timeoutMs);
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
  }
  if (result === null || typeof result !== "object" || Array.isArray(result) || typeof (result as { verified?: unknown }).verified !== "boolean") {
    throw new RecommendationEvidenceVerificationError(kind, "malformed");
  }
  if ((result as { verified: boolean }).verified !== true) throw new RecommendationEvidenceVerificationError(kind, "rejected");
}

/**
 * Verifies every item in order and stops at the first failure. With no verifier the items are left
 * alone and the result says `unverified`. With a verifier and nothing to check it also says
 * `unverified`, because no check ran. A verifier can only reject; it never widens what evidence may do.
 */
export async function verifyRecommendationEvidence(
  configured: NormalizedRecommendationEvidenceVerifier | undefined,
  items: readonly unknown[],
  kind: RecommendationEvidenceKind,
  subjectId: string,
  now: string
): Promise<RecommendationEvidenceVerification> {
  if (configured === undefined || items.length === 0) return RECOMMENDATION_EVIDENCE_UNVERIFIED;
  for (const item of items) await verifyOne(configured, item, kind, subjectId, now);
  return Object.freeze({ evidenceVerification: "verified" as const, verifierId: configured.verifier.id });
}

/** Failures throw, so any `verified` result means every check that ran passed. `unverified` means none ran. */
export function combineRecommendationEvidenceVerification(results: readonly RecommendationEvidenceVerification[]): RecommendationEvidenceVerification {
  return results.find((result) => result.evidenceVerification === "verified") ?? RECOMMENDATION_EVIDENCE_UNVERIFIED;
}
