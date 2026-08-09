import { sha256Hex } from "../runtime/hash.js";
import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_PROTOCOLS,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
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

export const RECOMMENDATION_CANDIDATE_SOURCE_TRANSPORTS = ["local", "remote"] as const;
export type RecommendationCandidateSourceTransport =
  typeof RECOMMENDATION_CANDIDATE_SOURCE_TRANSPORTS[number];

export interface RecommendationCandidateSourcePrivacyContext {
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData: boolean;
  containsThirdPartyData: boolean;
  serverSideProcessing: boolean;
  providerPolicyAllowsProcessing: boolean;
}

/** Caller-side discovery context. This object is closed at runtime. */
export interface RecommendationCandidateSourceAdapterReadRequest {
  requestId: string;
  candidateKinds: readonly RecommendationCandidateKind[];
  canonicalInterestIds: readonly string[];
  languages?: readonly string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Adapter-visible query. Remote adapters receive a privacy-redacted form that
 * omits profile-derived interests and language preferences and hashes requestId.
 */
export interface RecommendationCandidateSourceAdapterQuery {
  requestId: string;
  candidateKinds: readonly RecommendationCandidateKind[];
  canonicalInterestIds?: readonly string[];
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
  transport: RecommendationCandidateSourceTransport;
  privacy: RecommendationCandidateSourcePrivacyContext;
  capabilities: readonly RecommendationCandidateSourceCapability[];
  evaluateProviderPolicy?: (
    query: RecommendationCandidateSourceAdapterQuery
  ) => boolean | Promise<boolean>;
  read(
    query: RecommendationCandidateSourceAdapterQuery
  ): RecommendationCandidateSourceAdapterReadResult | Promise<RecommendationCandidateSourceAdapterReadResult>;
}

const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const CANDIDATE_KIND_SET = new Set<string>(RECOMMENDATION_CANDIDATE_KINDS);
const AUTHORITY_SET = new Set<string>(RECOMMENDATION_CANDIDATE_SOURCE_AUTHORITIES);
const CAPABILITY_SET = new Set<string>(RECOMMENDATION_CANDIDATE_SOURCE_CAPABILITIES);
const TRANSPORT_SET = new Set<string>(RECOMMENDATION_CANDIDATE_SOURCE_TRANSPORTS);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);
const REQUEST_KEYS = new Set([
  "requestId",
  "candidateKinds",
  "canonicalInterestIds",
  "languages",
  "cursor",
  "limit",
  "signal"
]);
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

function assertClosedRequest(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!REQUEST_KEYS.has(key)) {
      throw new TypeError("Recommendation candidate source request contains unsupported context.");
    }
  }
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

function isTransport(value: unknown): value is RecommendationCandidateSourceTransport {
  return typeof value === "string" && TRANSPORT_SET.has(value);
}

function isVisibility(value: unknown): value is RecommendationSourceVisibility {
  return typeof value === "string" && VISIBILITY_SET.has(value);
}

function isAccessBasis(value: unknown): value is RecommendationAccessBasis {
  return typeof value === "string" && ACCESS_BASIS_SET.has(value);
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

function normalizePrivacyContext(value: unknown): RecommendationCandidateSourcePrivacyContext {
  if (!isRecord(value) || !isVisibility(value.sourceVisibility) || !isAccessBasis(value.accessBasis)) {
    throw new TypeError("Invalid recommendation candidate source privacy context.");
  }
  if (
    typeof value.containsPrivateData !== "boolean" ||
    typeof value.containsThirdPartyData !== "boolean" ||
    typeof value.serverSideProcessing !== "boolean" ||
    typeof value.providerPolicyAllowsProcessing !== "boolean"
  ) {
    throw new TypeError("Invalid recommendation candidate source privacy context.");
  }
  return Object.freeze({
    sourceVisibility: value.sourceVisibility,
    accessBasis: value.accessBasis,
    containsPrivateData: value.containsPrivateData,
    containsThirdPartyData: value.containsThirdPartyData,
    serverSideProcessing: value.serverSideProcessing,
    providerPolicyAllowsProcessing: value.providerPolicyAllowsProcessing
  });
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

function validatePrivacyForTransport(
  transport: RecommendationCandidateSourceTransport,
  privacy: RecommendationCandidateSourcePrivacyContext
): void {
  if (!privacy.providerPolicyAllowsProcessing) {
    throw new TypeError("Recommendation candidate source provider policy denies processing.");
  }
  if (transport === "remote") {
    if (
      privacy.containsPrivateData ||
      (privacy.sourceVisibility !== "public" && privacy.sourceVisibility !== "atproto_public_repo") ||
      !privacy.serverSideProcessing
    ) {
      throw new TypeError("Remote recommendation candidate source must use public discovery data only.");
    }
  } else if (privacy.serverSideProcessing) {
    throw new TypeError("Local recommendation candidate source cannot declare server-side processing.");
  }
}

export function normalizeRecommendationCandidateSourceAdapterReadRequest(
  value: unknown
): RecommendationCandidateSourceAdapterReadRequest {
  if (!isRecord(value)) throw new TypeError("Invalid recommendation candidate source request.");
  assertClosedRequest(value);
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

function buildAdapterQuery(
  adapter: RecommendationCandidateSourceAdapter,
  request: RecommendationCandidateSourceAdapterReadRequest
): RecommendationCandidateSourceAdapterQuery {
  const query: RecommendationCandidateSourceAdapterQuery = {
    requestId: adapter.transport === "remote"
      ? `candidate-query:v1:${sha256Hex(request.requestId)}`
      : request.requestId,
    candidateKinds: request.candidateKinds
  };
  if (adapter.transport === "local") {
    query.canonicalInterestIds = request.canonicalInterestIds;
    if (request.languages !== undefined) query.languages = request.languages;
  }
  if (request.cursor !== undefined) query.cursor = request.cursor;
  if (request.limit !== undefined) query.limit = request.limit;
  if (request.signal !== undefined) query.signal = request.signal;
  return Object.freeze(query);
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
    if (!isAuthority(value.authority) || !isTransport(value.transport)) return false;
    const privacy = normalizePrivacyContext(value.privacy);
    const capabilities = uniqueKnownValues(
      value.capabilities,
      isCapability,
      "Invalid recommendation candidate source adapter capabilities."
    );
    validateCapabilityConsistency(value.authority, capabilities);
    validatePrivacyForTransport(value.transport, privacy);
    return (
      protocols.length > 0 &&
      candidateKinds.length > 0 &&
      typeof value.read === "function" &&
      (value.evaluateProviderPolicy === undefined || typeof value.evaluateProviderPolicy === "function")
    );
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
    candidate.verification.state === "unverified_hint" &&
    !adapter.capabilities.includes("returns_untrusted_hints")
  ) {
    throw new TypeError("Recommendation candidate hint exceeds declared adapter capabilities.");
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
  if (
    normalizedRequest.cursor !== undefined &&
    !adapter.capabilities.includes("supports_pagination")
  ) {
    throw new TypeError("Recommendation candidate source adapter does not declare pagination support.");
  }
  if (normalizedRequest.signal?.aborted === true) {
    throw normalizedRequest.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  if (
    normalizedRequest.signal !== undefined &&
    !adapter.capabilities.includes("supports_abort")
  ) {
    throw new TypeError("Recommendation candidate source adapter does not declare abort support.");
  }

  const query = buildAdapterQuery(adapter, normalizedRequest);
  if (adapter.evaluateProviderPolicy !== undefined) {
    const allowed = await adapter.evaluateProviderPolicy(query);
    if (allowed !== true) {
      throw new TypeError("Recommendation candidate source provider policy denies processing.");
    }
  }

  const result = await adapter.read(query);
  return normalizeRecommendationCandidateSourceAdapterReadResult(adapter, normalizedRequest, result);
}
