import {
  RECOMMENDATION_PROTOCOLS,
  type RecommendationProtocol
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_CANDIDATE_KINDS,
  normalizeRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationCandidateKind,
  type RecommendationCandidateVerificationState
} from "./candidate-domain.js";

export const RECOMMENDATION_CANDIDATE_SOURCE_AUTHORITIES = [
  "untrusted_hint",
  "curated_public",
  "provider_native",
  "protocol_native",
  "local_canonical"
] as const;

export type RecommendationCandidateSourceAuthority =
  typeof RECOMMENDATION_CANDIDATE_SOURCE_AUTHORITIES[number];

export const RECOMMENDATION_CANDIDATE_SOURCE_CAPABILITIES = [
  "discover",
  "supports_pagination",
  "supports_abort",
  "returns_public_metadata",
  "returns_untrusted_hints",
  "returns_authority_verified_identity"
] as const;

export type RecommendationCandidateSourceCapability =
  typeof RECOMMENDATION_CANDIDATE_SOURCE_CAPABILITIES[number];

export interface RecommendationCandidateSourceAdapterReadRequest {
  requestId: string;
  candidateKinds: readonly RecommendationCandidateKind[];
  canonicalInterestIds: readonly string[];
  languages?: readonly string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface RecommendationCandidateSourceAdapterReadResult {
  candidates: readonly RecommendationCandidate[];
  cursor?: string;
}

export interface RecommendationCandidateSourceAdapter {
  id: string;
  protocols: readonly RecommendationProtocol[];
  candidateKinds: readonly RecommendationCandidateKind[];
  authority: RecommendationCandidateSourceAuthority;
  capabilities: readonly RecommendationCandidateSourceCapability[];
  read(
    request: RecommendationCandidateSourceAdapterReadRequest
  ): RecommendationCandidateSourceAdapterReadResult | Promise<RecommendationCandidateSourceAdapterReadResult>;
}

const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const CANDIDATE_KIND_SET = new Set<string>(RECOMMENDATION_CANDIDATE_KINDS);
const AUTHORITY_SET = new Set<string>(RECOMMENDATION_CANDIDATE_SOURCE_AUTHORITIES);
const CAPABILITY_SET = new Set<string>(RECOMMENDATION_CANDIDATE_SOURCE_CAPABILITIES);
const MAX_ADAPTER_ID_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 512;
const MAX_INTEREST_ID_LENGTH = 512;
const MAX_LANGUAGE_LENGTH = 64;
const MAX_CURSOR_LENGTH = 1_024;
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 5_000;
const MAX_REQUEST_INTERESTS = 256;
const MAX_REQUEST_LANGUAGES = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  maximum: number,
  message: string
): string | undefined {
  return value === undefined ? undefined : boundedString(value, maximum, message);
}

function isProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
}

function isCandidateKind(value: unknown): value is RecommendationCandidateKind {
  return typeof value === "string" && CANDIDATE_KIND_SET.has(value);
}

function isAuthority(value: unknown): value is RecommendationCandidateSourceAuthority {
  return typeof value === "string" && AUTHORITY_SET.has(value);
}

function isCapability(value: unknown): value is RecommendationCandidateSourceCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

function uniqueKnownValues<T extends string>(
  value: unknown,
  isKnown: (entry: unknown) => entry is T,
  message: string,
  maximum = 32
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum || !value.every(isKnown)) {
    throw new TypeError(message);
  }
  if (new Set(value).size !== value.length) throw new TypeError(message);
  return Object.freeze([...value]);
}

function uniqueBoundedStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  message: string
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError(message);
  const normalized = value.map((entry) => boundedString(entry, maximumLength, message));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(message);
  return Object.freeze([...normalized]);
}

function normalizeLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) {
    throw new TypeError("Invalid recommendation candidate source limit.");
  }
  return value as number;
}

function allowedVerificationStates(
  authority: RecommendationCandidateSourceAuthority
): ReadonlySet<RecommendationCandidateVerificationState> {
  switch (authority) {
    case "untrusted_hint":
      return new Set(["unverified_hint"]);
    case "curated_public":
      return new Set(["unverified_hint", "source_asserted"]);
    case "provider_native":
    case "protocol_native":
      return new Set(["unverified_hint", "source_asserted", "authority_verified"]);
    case "local_canonical":
      return new Set(["source_asserted", "authority_verified", "canonical"]);
  }
}

function validateCapabilityConsistency(
  authority: RecommendationCandidateSourceAuthority,
  capabilities: readonly RecommendationCandidateSourceCapability[]
): void {
  if (!capabilities.includes("discover")) {
    throw new TypeError("Recommendation candidate source adapter must declare discovery capability.");
  }
  if (authority === "untrusted_hint" && !capabilities.includes("returns_untrusted_hints")) {
    throw new TypeError("Untrusted candidate source adapter must declare untrusted-hint capability.");
  }
  if (
    authority === "untrusted_hint" &&
    capabilities.includes("returns_authority_verified_identity")
  ) {
    throw new TypeError("Untrusted candidate source adapter cannot claim authoritative identity verification.");
  }
  if (
    capabilities.includes("returns_authority_verified_identity") &&
    authority !== "provider_native" &&
    authority !== "protocol_native" &&
    authority !== "local_canonical"
  ) {
    throw new TypeError("Candidate source verification capability exceeds adapter authority.");
  }
}

export function normalizeRecommendationCandidateSourceAdapterReadRequest(
  value: unknown
): RecommendationCandidateSourceAdapterReadRequest {
  if (!isRecord(value)) throw new TypeError("Invalid recommendation candidate source request.");
  const requestId = boundedString(
    value.requestId,
    MAX_REQUEST_ID_LENGTH,
    "Invalid recommendation candidate source request ID."
  );
  const candidateKinds = uniqueKnownValues(
    value.candidateKinds,
    isCandidateKind,
    "Invalid recommendation candidate source requested kinds."
  );
  const canonicalInterestIds = uniqueBoundedStrings(
    value.canonicalInterestIds,
    MAX_REQUEST_INTERESTS,
    MAX_INTEREST_ID_LENGTH,
    "Invalid recommendation candidate source interests."
  );
  const languages = value.languages === undefined
    ? undefined
    : uniqueBoundedStrings(
        value.languages,
        MAX_REQUEST_LANGUAGES,
        MAX_LANGUAGE_LENGTH,
        "Invalid recommendation candidate source languages."
      );
  const cursor = optionalBoundedString(
    value.cursor,
    MAX_CURSOR_LENGTH,
    "Invalid recommendation candidate source cursor."
  );
  const limit = normalizeLimit(value.limit);
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) {
    throw new TypeError("Invalid recommendation candidate source abort signal.");
  }

  const normalized: RecommendationCandidateSourceAdapterReadRequest = {
    requestId,
    candidateKinds,
    canonicalInterestIds
  };
  if (languages !== undefined) normalized.languages = languages;
  if (cursor !== undefined) normalized.cursor = cursor;
  if (limit !== undefined) normalized.limit = limit;
  if (value.signal !== undefined) normalized.signal = value.signal;
  return Object.freeze(normalized);
}

export function isRecommendationCandidateSourceAdapter(
  value: unknown
): value is RecommendationCandidateSourceAdapter {
  if (!isRecord(value)) return false;
  try {
    boundedString(value.id, MAX_ADAPTER_ID_LENGTH, "Invalid recommendation candidate source adapter ID.");
    const protocols = uniqueKnownValues(
      value.protocols,
      isProtocol,
      "Invalid recommendation candidate source adapter protocols."
    );
    const candidateKinds = uniqueKnownValues(
      value.candidateKinds,
      isCandidateKind,
      "Invalid recommendation candidate source adapter kinds."
    );
    if (!isAuthority(value.authority)) return false;
    const capabilities = uniqueKnownValues(
      value.capabilities,
      isCapability,
      "Invalid recommendation candidate source adapter capabilities."
    );
    validateCapabilityConsistency(value.authority, capabilities);
    return protocols.length > 0 && candidateKinds.length > 0 && typeof value.read === "function";
  } catch {
    return false;
  }
}

function assertCandidateMatchesAdapter(
  candidate: RecommendationCandidate,
  adapter: RecommendationCandidateSourceAdapter
): void {
  if (!adapter.protocols.includes(candidate.protocol)) {
    throw new TypeError("Recommendation candidate protocol is not declared by source adapter.");
  }
  if (!adapter.candidateKinds.includes(candidate.kind)) {
    throw new TypeError("Recommendation candidate kind is not declared by source adapter.");
  }
  const permitted = allowedVerificationStates(adapter.authority);
  if (!permitted.has(candidate.verification.state)) {
    throw new TypeError("Recommendation candidate verification exceeds source adapter authority.");
  }
  if (
    (candidate.verification.state === "authority_verified" || candidate.verification.state === "canonical") &&
    !adapter.capabilities.includes("returns_authority_verified_identity")
  ) {
    throw new TypeError("Recommendation candidate verification exceeds declared adapter capabilities.");
  }
}

export function normalizeRecommendationCandidateSourceAdapterReadResult(
  adapter: RecommendationCandidateSourceAdapter,
  request: RecommendationCandidateSourceAdapterReadRequest,
  value: unknown
): RecommendationCandidateSourceAdapterReadResult {
  if (!isRecommendationCandidateSourceAdapter(adapter) || !isRecord(value) || !Array.isArray(value.candidates)) {
    throw new TypeError("Invalid recommendation candidate source result.");
  }
  const normalizedRequest = normalizeRecommendationCandidateSourceAdapterReadRequest(request);
  const effectiveLimit = normalizedRequest.limit ?? DEFAULT_LIMIT;
  if (value.candidates.length > effectiveLimit) {
    throw new RangeError("Recommendation candidate source result exceeds requested limit.");
  }
  const candidates = value.candidates.map((entry) => normalizeRecommendationCandidate(entry));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    assertCandidateMatchesAdapter(candidate, adapter);
    if (!normalizedRequest.candidateKinds.includes(candidate.kind)) {
      throw new TypeError("Recommendation candidate source returned an unrequested candidate kind.");
    }
    if (seen.has(candidate.candidateId)) {
      throw new TypeError("Recommendation candidate source returned duplicate candidate identity.");
    }
    seen.add(candidate.candidateId);
  }
  const cursor = optionalBoundedString(
    value.cursor,
    MAX_CURSOR_LENGTH,
    "Invalid recommendation candidate source result cursor."
  );
  if (cursor !== undefined && !adapter.capabilities.includes("supports_pagination")) {
    throw new TypeError("Recommendation candidate source returned a cursor without pagination capability.");
  }

  const normalized: RecommendationCandidateSourceAdapterReadResult = {
    candidates: Object.freeze(candidates)
  };
  if (cursor !== undefined) normalized.cursor = cursor;
  return Object.freeze(normalized);
}

export async function readRecommendationCandidateSourceAdapter(
  adapter: RecommendationCandidateSourceAdapter,
  request: RecommendationCandidateSourceAdapterReadRequest
): Promise<RecommendationCandidateSourceAdapterReadResult> {
  if (!isRecommendationCandidateSourceAdapter(adapter)) {
    throw new TypeError("Invalid recommendation candidate source adapter.");
  }
  const normalizedRequest = normalizeRecommendationCandidateSourceAdapterReadRequest(request);
  if (normalizedRequest.signal?.aborted === true) {
    throw normalizedRequest.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  if (
    normalizedRequest.signal !== undefined &&
    !adapter.capabilities.includes("supports_abort")
  ) {
    throw new TypeError("Recommendation candidate source adapter does not declare abort support.");
  }
  const result = await adapter.read(normalizedRequest);
  return normalizeRecommendationCandidateSourceAdapterReadResult(adapter, normalizedRequest, result);
}
