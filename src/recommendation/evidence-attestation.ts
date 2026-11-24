import { createHash, timingSafeEqual } from "node:crypto";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_EVIDENCE_KINDS,
  normalizeRecommendationEvidenceVerifierOptions,
  type NormalizedRecommendationEvidenceVerifier,
  type RecommendationEvidenceKind,
  type RecommendationEvidenceVerifier,
  type RecommendationEvidenceVerifierContext,
  type RecommendationEvidenceVerifierOptions
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
 * origin, optionally with an authenticated fetch). The rest mean a signature was verified.
 * `atproto_label_signature` is issued by `createRecommendationAtprotoLabelAttestation`. Every
 * mechanism carries a content digest.
 */
export const RECOMMENDATION_EVIDENCE_ATTESTATION_MECHANISMS = [
  "https_origin",
  "authenticated_fetch",
  "protocol_signature",
  "application_signature",
  "atproto_label_signature"
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
const INPUT_KEYS = ["subjectId", "sourceIds", "kind", "claim", "mechanism", "authority", "verifiedAt", "verifierId", "contentDigest", "expiresAt"];
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 100_000;
const MAX_CANONICAL_BYTES = 1_048_576;

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
  /**
   * `sha256:` plus 64 lowercase hex characters, from `recommendationEvidenceContentDigest` over the
   * evidence that was checked. Required for every mechanism. The verifier hashes the evidence it is
   * given and accepts only an exact match, so the attestation cannot be reused for other content.
   */
  contentDigest: string;
  /** RFC 3339. After this the attestation is refused even if it is still fresh, for example when the signed label expires. */
  expiresAt?: string;
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
  readonly contentDigest: string;
  readonly expiresAt?: string;
}

// Only objects made by the issuing function are in here. A literal, a parsed JSON copy or a structured
// clone of an attestation is not, so data that merely looks like one is never trusted.
const ISSUED = new WeakSet<object>();

export function recommendationEvidenceAttestationProof(
  mechanism: RecommendationEvidenceAttestationMechanism
): RecommendationEvidenceAttestationProof {
  return mechanism === "https_origin" || mechanism === "authenticated_fetch" ? "origin" : "signature";
}

function canonicalize(value: unknown, depth: number, budget: { nodes: number }): string {
  if (depth > MAX_CANONICAL_DEPTH || (budget.nodes += 1) > MAX_CANONICAL_NODES) throw new TypeError("Evidence is too deep or too large to digest.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence holds a number that cannot be digested.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (value instanceof Uint8Array) return `bytes(${JSON.stringify(Buffer.from(value).toString("base64"))})`;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Evidence holds a sparse array or accessor.");
      parts.push(canonicalize(descriptor.value, depth + 1, budget));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Evidence holds an object that is not plain data.");
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("Evidence holds an accessor property.");
      parts.push(`${JSON.stringify(key)}:${canonicalize(descriptor.value, depth + 1, budget)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new TypeError("Evidence holds a value that cannot be digested.");
}

/**
 * SHA-256 over a canonical encoding of plain data: sorted keys, no whitespace, `Uint8Array` as
 * `bytes("<base64>")`, which no JSON value can encode to, so a byte array never shares a digest with a
 * plain object such as `{ $bytes: "<base64>" }`. Throws `TypeError` for anything that is not plain data (undefined, functions,
 * symbols, bigint, NaN or Infinity, class instances, getters, sparse arrays) and for input that is
 * more than 32 levels deep, over 100,000 values or over 1 MiB once encoded. Refusing these keeps two
 * different values from sharing a digest and keeps a getter from showing different data later.
 */
export function recommendationEvidenceContentDigest(value: unknown): string {
  const encoded = canonicalize(value, 0, { nodes: 0 });
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANONICAL_BYTES) throw new TypeError("Evidence is too large to digest.");
  return `sha256:${createHash("sha256").update(encoded, "utf8").digest("hex")}`;
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
  const contentDigest = record.contentDigest;
  if (typeof contentDigest !== "string" || !DIGEST_PATTERN.test(contentDigest)) {
    throw new TypeError("A recommendation evidence attestation must carry a content digest (sha256: plus 64 lowercase hex characters).");
  }
  const expiresAt = record.expiresAt === undefined
    ? undefined
    : normalizeStrictRfc3339Timestamp(record.expiresAt, "Invalid recommendation evidence attestation expiry.");
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
    verifierId,
    contentDigest,
    ...(expiresAt === undefined ? {} : { expiresAt })
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
  /** Digest of the evidence being checked, from `recommendationEvidenceContentDigest`. The attestation must carry the same one. */
  contentDigest: string;
}

export type RecommendationEvidenceAttestationRejection =
  | "not_issued"
  | "subject_mismatch"
  | "source_mismatch"
  | "kind_mismatch"
  | "future_dated"
  | "expired"
  | "proof_insufficient"
  | "authority_insufficient"
  | "attestation_expired"
  | "digest_mismatch";

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
  if (typeof requirement.contentDigest !== "string" || !DIGEST_PATTERN.test(requirement.contentDigest)) {
    throw new TypeError("Invalid recommendation evidence requirement digest.");
  }
  const nowMs = Date.parse(normalizeStrictRfc3339Timestamp(requirement.now, "Invalid recommendation evidence requirement time."));

  if (!isIssuedRecommendationEvidenceAttestation(attestation)) return reject("not_issued");
  if (attestation.subjectId !== subjectId) return reject("subject_mismatch");
  if (attestation.kind !== requirement.kind) return reject("kind_mismatch");
  if (attestation.sourceIds.length !== wanted.length || attestation.sourceIds.some((id, index) => id !== wanted[index])) return reject("source_mismatch");
  const verifiedMs = Date.parse(attestation.verifiedAt);
  if (verifiedMs > nowMs) return reject("future_dated");
  if (nowMs - verifiedMs > maxAgeMs) return reject("expired");
  if (attestation.expiresAt !== undefined && Date.parse(attestation.expiresAt) <= nowMs) return reject("attestation_expired");
  if (requirement.requiredProof === "signature" && attestation.proof !== "signature") return reject("proof_insufficient");
  if (!recommendationProviderDiscoveryAuthorityAtLeast(attestation.authority, requirement.minimumAuthority)) return reject("authority_insufficient");
  if (!constantTimeEqual(attestation.contentDigest, requirement.contentDigest)) return reject("digest_mismatch");
  return Object.freeze({ verified: true as const });
}

function constantTimeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
 * an issued attestation matches the subject, kind and source ids, carries the digest of the evidence
 * itself, and is fresh and strong enough. Every
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
    contentDigest: `sha256:${"0".repeat(64)}`,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs })
  });
  // Content binding is no longer optional. Refuse the old switch so stale config cannot look like it still means something.
  if ("bindContent" in (options as object)) throw new TypeError("bindContent was removed. Every attestation is now bound to the evidence content.");
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
        // Throws for evidence that is not plain data, which the hook treats as a rejection.
        contentDigest: recommendationEvidenceContentDigest(evidence),
        ...(maxAgeMs === undefined ? {} : { maxAgeMs })
      });
      return { verified: result.verified };
    }
  });
}

/** Most attestations one call may carry. A longer list is refused outright so a caller cannot make every item scan an unbounded list. */
export const MAX_RECOMMENDATION_EVIDENCE_ATTESTATIONS_PER_CALL = 4_096;

const ATTESTATION_POLICY_VERIFIER_ID = "attestation-policy";
const EVENT_SOURCE_FIELDS = ["setSourceId", "sourceId", "candidateId", "accountUri", "providerId"] as const;

/**
 * The source ids an attestation has to list for an item of evidence, read from the evidence itself.
 * Issuers of attestations for the lifecycle use the same function so both sides agree.
 *
 * - `lifecycle_event`: every one of `setSourceId`, `sourceId`, `candidateId`, `accountUri` and `providerId` the event has.
 * - `starter_pack_consent` (a plan member): its `consentSetSourceId` and `accountUri`.
 * - `starter_pack_provenance` (a provenance entry): its `sourceId`.
 *
 * Throws `TypeError` when the evidence has none, so evidence that names no source cannot be attested.
 */
export function recommendationEvidenceAttestationSourceIds(kind: RecommendationEvidenceKind, evidence: unknown): readonly string[] {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) throw new TypeError("Evidence names no source.");
  const record = evidence as Record<string, unknown>;
  const fields: readonly string[] = kind === "lifecycle_event" ? EVENT_SOURCE_FIELDS
    : kind === "starter_pack_consent" ? ["consentSetSourceId", "accountUri"]
      : ["sourceId"];
  const ids = fields.flatMap((field) => (typeof record[field] === "string" ? [record[field] as string] : []));
  if (ids.length === 0) throw new TypeError("Evidence names no source.");
  return Object.freeze([...new Set(ids)].sort());
}

export interface RecommendationEvidenceAttestationPolicyOptions {
  /**
   * Turns the policy on. `signature` accepts only attestations whose mechanism verified a signature.
   * `origin` also accepts an attestation that only says the data came from the right origin. Leave it
   * out and nothing about evidence changes: it is used as supplied and results say `unverified`.
   */
  minimumAttestation: RecommendationEvidenceAttestationProof;
  /** Weakest authority an attestation may claim. Default `protocol_native`. */
  minimumAttestationAuthority?: RecommendationProviderDiscoveryAuthority;
  /** How old an attestation may be. Default 15 minutes, at most 7 days. */
  attestationMaxAgeMs?: number;
}

/**
 * The `evidenceVerifier` option of the onboarding lifecycle. Without `minimumAttestation` it is the
 * plain verifier options and behaves as before. With it, `verifier` becomes optional: every item of
 * evidence must first be covered by a valid attestation passed in the call's `attestations`, and a
 * `verifier`, if one is also given, must accept it too.
 */
export type RecommendationEvidenceVerificationOptions =
  | RecommendationEvidenceVerifierOptions
  | (Omit<RecommendationEvidenceVerifierOptions, "verifier"> & Partial<Pick<RecommendationEvidenceVerifierOptions, "verifier">> & RecommendationEvidenceAttestationPolicyOptions);

function attestationCovers(
  evidence: unknown,
  context: RecommendationEvidenceVerifierContext,
  policy: { minimumAttestation: RecommendationEvidenceAttestationProof; minimumAuthority: RecommendationProviderDiscoveryAuthority; maxAgeMs?: number }
): boolean {
  const attestations = context.attestations;
  if (!Array.isArray(attestations) || attestations.length === 0) return false;
  let requirement: RecommendationEvidenceAttestationRequirement;
  try {
    requirement = {
      subjectId: context.subjectId,
      sourceIds: recommendationEvidenceAttestationSourceIds(context.kind, evidence),
      kind: context.kind,
      now: context.now,
      requiredProof: policy.minimumAttestation,
      minimumAuthority: policy.minimumAuthority,
      contentDigest: recommendationEvidenceContentDigest(evidence),
      ...(policy.maxAgeMs === undefined ? {} : { maxAgeMs: policy.maxAgeMs })
    };
  } catch {
    // Evidence that cannot be hashed or names no source cannot be attested.
    return false;
  }
  for (const candidate of attestations) {
    if (!isIssuedRecommendationEvidenceAttestation(candidate) || candidate.contentDigest !== requirement.contentDigest) continue;
    try {
      if (evaluateRecommendationEvidenceAttestation(candidate, requirement).verified) return true;
    } catch {
      // A requirement that cannot be evaluated counts as not covered.
    }
  }
  return false;
}

/**
 * Normalizes the lifecycle's `evidenceVerifier` option. Without `minimumAttestation` this is exactly
 * `normalizeRecommendationEvidenceVerifierOptions`. With it, the returned verifier refuses every item
 * that no attestation in the call covers, with the hook's ordinary fixed `rejected` failure (no
 * subject id or evidence content in the message), then asks the application's own verifier if there is one.
 */
export function normalizeRecommendationEvidenceVerificationOptions(options: unknown): NormalizedRecommendationEvidenceVerifier {
  if (options === null || typeof options !== "object" || Array.isArray(options) || !("minimumAttestation" in options)) {
    return normalizeRecommendationEvidenceVerifierOptions(options);
  }
  const { minimumAttestation, minimumAttestationAuthority, attestationMaxAgeMs, verifier, ...rest } = options as Partial<RecommendationEvidenceAttestationPolicyOptions> & Partial<RecommendationEvidenceVerifierOptions>;
  if (minimumAttestation !== "origin" && minimumAttestation !== "signature") throw new TypeError("Invalid recommendation attestation policy.");
  const minimumAuthority = minimumAttestationAuthority ?? "protocol_native";
  // Same checks as a per-item requirement, so a bad setting fails now and not on the first item.
  evaluateRecommendationEvidenceAttestation(undefined, {
    subjectId: "check", sourceIds: ["check"], kind: "lifecycle_event", now: "2026-01-01T00:00:00.000Z",
    requiredProof: minimumAttestation, minimumAuthority, contentDigest: `sha256:${"0".repeat(64)}`,
    ...(attestationMaxAgeMs === undefined ? {} : { maxAgeMs: attestationMaxAgeMs })
  });
  if (verifier !== undefined) {
    // Validate the application's verifier the usual way before wrapping it.
    normalizeRecommendationEvidenceVerifierOptions({ ...rest, verifier });
  }
  const policy = { minimumAttestation, minimumAuthority, ...(attestationMaxAgeMs === undefined ? {} : { maxAgeMs: attestationMaxAgeMs }) };
  const combined: RecommendationEvidenceVerifier = Object.freeze({
    id: verifier?.id ?? ATTESTATION_POLICY_VERIFIER_ID,
    verify(evidence: unknown, context: RecommendationEvidenceVerifierContext) {
      if (!attestationCovers(evidence, context, policy)) return { verified: false };
      return verifier === undefined ? { verified: true } : verifier.verify(evidence, context);
    }
  });
  return normalizeRecommendationEvidenceVerifierOptions({ ...rest, verifier: combined });
}

/** Bounds the attestation list a caller hands to a lifecycle call. Returns it unchanged, or throws `TypeError`. */
export function assertRecommendationEvidenceAttestationList(value: unknown): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_RECOMMENDATION_EVIDENCE_ATTESTATIONS_PER_CALL) throw new TypeError("Invalid recommendation evidence attestations.");
  return value;
}
