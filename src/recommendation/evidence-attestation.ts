import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_EVIDENCE_KINDS,
  type RecommendationEvidenceKind,
  type RecommendationEvidenceVerifier,
  type RecommendationEvidenceVerifierContext
} from "./evidence-verifier.js";
import {
  RECOMMENDATION_PROVIDER_DISCOVERY_AUTHORITIES,
  recommendationProviderDiscoveryAuthorityAtLeast,
  type RecommendationProviderDiscoveryAuthority
} from "./provider-discovery.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

/**
 * A small, protocol-neutral record that says "a check ran, here is what it covered and how strong it was".
 *
 * Adapters or application code that really did a check (an HTTPS fetch from the account's own origin,
 * a verified signature) issue one with `createRecommendationEvidenceAttestation`. The attestation
 * verifier below then accepts evidence only when such a record exists for the same subject and source
 * ids, is recent, and is strong enough. The library itself still verifies no protocol proof: whoever
 * calls the issuing function is the one vouching that the check happened.
 */
export const RECOMMENDATION_EVIDENCE_ATTESTATION_SCHEMA_VERSION = "recommendation-evidence-attestation.v1";

/**
 * How the evidence was checked. The first two only establish where the data came from (an HTTPS
 * origin, optionally with an authenticated fetch). The last two mean a signature was verified.
 */
export const RECOMMENDATION_EVIDENCE_ATTESTATION_MECHANISMS = [
  "https_origin",
  "authenticated_fetch",
  "protocol_signature",
  "application_signature"
] as const;
export type RecommendationEvidenceAttestationMechanism = typeof RECOMMENDATION_EVIDENCE_ATTESTATION_MECHANISMS[number];

/** `origin` means the data came from the right place. `signature` means a signature was checked. */
export type RecommendationEvidenceAttestationProof = "origin" | "signature";

export const DEFAULT_RECOMMENDATION_EVIDENCE_ATTESTATION_MAX_AGE_MS = 15 * 60_000;
export const MAX_RECOMMENDATION_EVIDENCE_ATTESTATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const MAX_RECOMMENDATION_EVIDENCE_ATTESTATION_SOURCE_IDS = 32;

const MAX_ID_LENGTH = 512;
const MAX_CLAIM_LENGTH = 256;
const MAX_VERIFIER_ID_LENGTH = 128;
const MECHANISM_SET = new Set<string>(RECOMMENDATION_EVIDENCE_ATTESTATION_MECHANISMS);
const AUTHORITY_SET = new Set<string>(RECOMMENDATION_PROVIDER_DISCOVERY_AUTHORITIES);
const KIND_SET = new Set<string>(RECOMMENDATION_EVIDENCE_KINDS);
const INPUT_KEYS = ["subjectId", "sourceIds", "kind", "claim", "mechanism", "authority", "verifiedAt", "verifierId"];

export interface RecommendationEvidenceAttestationInput {
  /** The subject the checked evidence belongs to. */
  subjectId: string;
  /** Every source the check covered, such as a curated set source id or an AT URI. Between 1 and 32. */
  sourceIds: readonly string[];
  kind: RecommendationEvidenceKind;
  /** Short plain statement of what was checked, for example "set membership read from the owner's origin". */
  claim: string;
  mechanism: RecommendationEvidenceAttestationMechanism;
  /** Same vocabulary as provider discovery. Origin-only mechanisms may not claim more than `protocol_native`. */
  authority: RecommendationProviderDiscoveryAuthority;
  /** When the check ran (RFC 3339). */
  verifiedAt: string;
  /** Short name of the step that ran the check. */
  verifierId: string;
}

export interface RecommendationEvidenceAttestation {
  readonly schemaVersion: typeof RECOMMENDATION_EVIDENCE_ATTESTATION_SCHEMA_VERSION;
  readonly subjectId: string;
  readonly sourceIds: readonly string[];
  readonly kind: RecommendationEvidenceKind;
  readonly claim: string;
  readonly mechanism: RecommendationEvidenceAttestationMechanism;
  /** Derived from the mechanism, never supplied. */
  readonly proof: RecommendationEvidenceAttestationProof;
  readonly authority: RecommendationProviderDiscoveryAuthority;
  readonly verifiedAt: string;
  readonly verifierId: string;
}

// Only objects made by the issuing function are in here. A literal, a parsed JSON copy or a structured
// clone of an attestation is not, so data that merely looks like one is never trusted.
const ISSUED = new WeakSet<object>();

export function recommendationEvidenceAttestationProof(
  mechanism: RecommendationEvidenceAttestationMechanism
): RecommendationEvidenceAttestationProof {
  return mechanism === "protocol_signature" || mechanism === "application_signature" ? "signature" : "origin";
}

function boundedText(value: unknown, max: number, message: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasUnsafeControlCharacter(value)) {
    throw new TypeError(message);
  }
  return value;
}

/**
 * Validates the input and returns a frozen attestation. Strings are rejected, not cleaned up, if they
 * are untrimmed or hold control characters, because quietly changing an id would change what it is
 * bound to. Throws `TypeError` on anything malformed.
 */
export function createRecommendationEvidenceAttestation(input: unknown): RecommendationEvidenceAttestation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid recommendation evidence attestation.");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !INPUT_KEYS.includes(key))) throw new TypeError("Unknown recommendation evidence attestation field.");
  const subjectId = boundedText(record.subjectId, MAX_ID_LENGTH, "Invalid recommendation evidence attestation subject.");
  const rawSources = record.sourceIds;
  if (!Array.isArray(rawSources) || rawSources.length === 0 || rawSources.length > MAX_RECOMMENDATION_EVIDENCE_ATTESTATION_SOURCE_IDS) {
    throw new TypeError("Invalid recommendation evidence attestation sources.");
  }
  const sourceIds = [...new Set(rawSources.map((id) => boundedText(id, MAX_ID_LENGTH, "Invalid recommendation evidence attestation source.")))].sort();
  if (typeof record.kind !== "string" || !KIND_SET.has(record.kind)) throw new TypeError("Invalid recommendation evidence attestation kind.");
  const claim = boundedText(record.claim, MAX_CLAIM_LENGTH, "Invalid recommendation evidence attestation claim.");
  if (typeof record.mechanism !== "string" || !MECHANISM_SET.has(record.mechanism)) throw new TypeError("Invalid recommendation evidence attestation mechanism.");
  if (typeof record.authority !== "string" || !AUTHORITY_SET.has(record.authority)) throw new TypeError("Invalid recommendation evidence attestation authority.");
  const mechanism = record.mechanism as RecommendationEvidenceAttestationMechanism;
  const authority = record.authority as RecommendationProviderDiscoveryAuthority;
  const proof = recommendationEvidenceAttestationProof(mechanism);
  if (proof === "origin" && !recommendationProviderDiscoveryAuthorityAtLeast("protocol_native", authority)) {
    throw new TypeError("An origin-only attestation cannot claim more than protocol_native authority.");
  }
  const verifiedAt = normalizeStrictRfc3339Timestamp(record.verifiedAt, "Invalid recommendation evidence attestation time.");
  const verifierId = boundedText(record.verifierId, MAX_VERIFIER_ID_LENGTH, "Invalid recommendation evidence attestation verifier.");
  const attestation: RecommendationEvidenceAttestation = Object.freeze({
    schemaVersion: RECOMMENDATION_EVIDENCE_ATTESTATION_SCHEMA_VERSION,
    subjectId,
    sourceIds: Object.freeze(sourceIds),
    kind: record.kind as RecommendationEvidenceKind,
    claim,
    mechanism,
    proof,
    authority,
    verifiedAt,
    verifierId
  });
  ISSUED.add(attestation);
  return attestation;
}

/** True only for objects returned by `createRecommendationEvidenceAttestation` in this process. */
export function isIssuedRecommendationEvidenceAttestation(value: unknown): value is RecommendationEvidenceAttestation {
  return value !== null && typeof value === "object" && ISSUED.has(value);
}

export interface RecommendationEvidenceAttestationRequirement {
  subjectId: string;
  /** The attestation must cover exactly these sources. */
  sourceIds: readonly string[];
  kind: RecommendationEvidenceKind;
  /** The caller's clock, RFC 3339. */
  now: string;
  /** `signature` refuses origin-only attestations. */
  requiredProof: RecommendationEvidenceAttestationProof;
  minimumAuthority: RecommendationProviderDiscoveryAuthority;
  /** Default 15 minutes, at most 7 days. */
  maxAgeMs?: number;
}

export type RecommendationEvidenceAttestationRejection =
  | "not_issued"
  | "subject_mismatch"
  | "source_mismatch"
  | "kind_mismatch"
  | "future_dated"
  | "expired"
  | "proof_insufficient"
  | "authority_insufficient";

export type RecommendationEvidenceAttestationResult =
  | { readonly verified: true }
  | { readonly verified: false; readonly reason: RecommendationEvidenceAttestationRejection };

function reject(reason: RecommendationEvidenceAttestationRejection): RecommendationEvidenceAttestationResult {
  return Object.freeze({ verified: false as const, reason });
}

/**
 * Decides whether an attestation covers the requirement. Anything that is not an issued attestation,
 * or does not match on every point, is rejected. A bad requirement is a programming error and throws.
 */
export function evaluateRecommendationEvidenceAttestation(
  attestation: unknown,
  requirement: RecommendationEvidenceAttestationRequirement
): RecommendationEvidenceAttestationResult {
  const subjectId = boundedText(requirement.subjectId, MAX_ID_LENGTH, "Invalid recommendation evidence requirement subject.");
  if (!Array.isArray(requirement.sourceIds) || requirement.sourceIds.length === 0 || requirement.sourceIds.length > MAX_RECOMMENDATION_EVIDENCE_ATTESTATION_SOURCE_IDS) {
    throw new TypeError("Invalid recommendation evidence requirement sources.");
  }
  const wanted = [...new Set(requirement.sourceIds.map((id) => boundedText(id, MAX_ID_LENGTH, "Invalid recommendation evidence requirement source.")))].sort();
  if (!KIND_SET.has(requirement.kind)) throw new TypeError("Invalid recommendation evidence requirement kind.");
  if (requirement.requiredProof !== "origin" && requirement.requiredProof !== "signature") throw new TypeError("Invalid recommendation evidence requirement proof.");
  if (!AUTHORITY_SET.has(requirement.minimumAuthority)) throw new TypeError("Invalid recommendation evidence requirement authority.");
  const maxAgeMs = requirement.maxAgeMs ?? DEFAULT_RECOMMENDATION_EVIDENCE_ATTESTATION_MAX_AGE_MS;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > MAX_RECOMMENDATION_EVIDENCE_ATTESTATION_MAX_AGE_MS) {
    throw new TypeError("Invalid recommendation evidence requirement age.");
  }
  const nowMs = Date.parse(normalizeStrictRfc3339Timestamp(requirement.now, "Invalid recommendation evidence requirement time."));

  if (!isIssuedRecommendationEvidenceAttestation(attestation)) return reject("not_issued");
  if (attestation.subjectId !== subjectId) return reject("subject_mismatch");
  if (attestation.kind !== requirement.kind) return reject("kind_mismatch");
  if (attestation.sourceIds.length !== wanted.length || attestation.sourceIds.some((id, index) => id !== wanted[index])) return reject("source_mismatch");
  const verifiedMs = Date.parse(attestation.verifiedAt);
  if (verifiedMs > nowMs) return reject("future_dated");
  if (nowMs - verifiedMs > maxAgeMs) return reject("expired");
  if (requirement.requiredProof === "signature" && attestation.proof !== "signature") return reject("proof_insufficient");
  if (!recommendationProviderDiscoveryAuthorityAtLeast(attestation.authority, requirement.minimumAuthority)) return reject("authority_insufficient");
  return Object.freeze({ verified: true as const });
}

export interface RecommendationAttestationEvidenceVerifierOptions {
  /** Name reported next to a verified result. */
  id: string;
  /** Finds the attestation that goes with an item of evidence. The event carries none, so the application keeps them. */
  attestationFor(evidence: unknown, context: RecommendationEvidenceVerifierContext): unknown | Promise<unknown>;
  /** The source ids the evidence relies on, taken from the evidence itself and not from the attestation. */
  sourceIdsFor(evidence: unknown, context: RecommendationEvidenceVerifierContext): readonly string[];
  requiredProof: RecommendationEvidenceAttestationProof;
  minimumAuthority: RecommendationProviderDiscoveryAuthority;
  maxAgeMs?: number;
}

/**
 * Builds a verifier for the existing `evidenceVerifier` hook. It answers `{ verified: true }` only when
 * an issued attestation matches the subject, kind and source ids, is fresh and strong enough. Every
 * other outcome, including a throw from the lookup, is a rejection by the hook's usual fail-closed rules.
 */
export function createRecommendationAttestationEvidenceVerifier(options: RecommendationAttestationEvidenceVerifierOptions): RecommendationEvidenceVerifier {
  boundedText(options?.id, MAX_VERIFIER_ID_LENGTH, "Invalid recommendation attestation verifier id.");
  if (typeof options.attestationFor !== "function" || typeof options.sourceIdsFor !== "function") {
    throw new TypeError("Invalid recommendation attestation verifier lookups.");
  }
  // Fail on a bad requirement now and not on the first item of evidence.
  evaluateRecommendationEvidenceAttestation(undefined, {
    subjectId: "check", sourceIds: ["check"], kind: "lifecycle_event", now: "2026-01-01T00:00:00.000Z",
    requiredProof: options.requiredProof, minimumAuthority: options.minimumAuthority,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs })
  });
  const { id, attestationFor, sourceIdsFor, requiredProof, minimumAuthority, maxAgeMs } = options;
  return Object.freeze({
    id,
    async verify(evidence: unknown, context: RecommendationEvidenceVerifierContext) {
      const attestation = await attestationFor(evidence, context);
      const result = evaluateRecommendationEvidenceAttestation(attestation, {
        subjectId: context.subjectId,
        sourceIds: sourceIdsFor(evidence, context),
        kind: context.kind,
        now: context.now,
        requiredProof,
        minimumAuthority,
        ...(maxAgeMs === undefined ? {} : { maxAgeMs })
      });
      return { verified: result.verified };
    }
  });
}
