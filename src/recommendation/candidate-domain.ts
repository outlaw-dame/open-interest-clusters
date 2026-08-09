import { normalizeHashtag } from "../normalization/hashtags.js";
import { sha256Hex } from "../runtime/hash.js";
import { RECOMMENDATION_PROTOCOLS, type RecommendationProtocol } from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_SOURCE_TRUST_BOUNDARIES,
  type RecommendationSourceTrustBoundary
} from "./source-adapter.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_KINDS = [
  "account",
  "post",
  "feed",
  "list",
  "starter_pack",
  "labeler",
  "community",
  "hashtag",
  "topic",
  "instance"
] as const;

export type RecommendationCandidateKind = typeof RECOMMENDATION_CANDIDATE_KINDS[number];

export const RECOMMENDATION_CANDIDATE_VERIFICATION_STATES = [
  "unverified_hint",
  "source_asserted",
  "authority_verified",
  "canonical"
] as const;

export type RecommendationCandidateVerificationState =
  typeof RECOMMENDATION_CANDIDATE_VERIFICATION_STATES[number];

export const RECOMMENDATION_CANDIDATE_AVAILABILITY_STATES = [
  "unknown",
  "available",
  "unavailable"
] as const;

export type RecommendationCandidateAvailabilityState =
  typeof RECOMMENDATION_CANDIDATE_AVAILABILITY_STATES[number];

export const RECOMMENDATION_CANDIDATE_PROVENANCE_KINDS = [
  "onboarding_interest_match",
  "curated_account_set",
  "legacy_follow_pack",
  "starter_pack",
  "featured_hashtag",
  "public_trend",
  "public_profile_metadata",
  "public_interaction_graph",
  "labeler_discovery",
  "provider_discovery",
  "third_party_directory_hint",
  "instance_directory_metadata",
  "local_catalog"
] as const;

export type RecommendationCandidateProvenanceKind =
  typeof RECOMMENDATION_CANDIDATE_PROVENANCE_KINDS[number];

export interface RecommendationCandidateVerification {
  state: RecommendationCandidateVerificationState;
  authority?: string;
  verifiedAt?: string;
}

export interface RecommendationCandidateProvenance {
  kind: RecommendationCandidateProvenanceKind;
  sourceId: string;
  observedAt: string;
  trustBoundary: RecommendationSourceTrustBoundary;
  sourceItemId?: string;
  curator?: string;
  sourceUrl?: string;
}

export interface RecommendationCandidateMetadata {
  displayName?: string;
  summary?: string;
  canonicalInterestIds: readonly string[];
  tags: readonly string[];
  entityIds: readonly string[];
  languages: readonly string[];
}

export interface RecommendationCandidateIdentityInput {
  kind: RecommendationCandidateKind;
  protocol: RecommendationProtocol;
  nativeId: string;
  provider?: string;
}

export interface RecommendationCandidate {
  candidateId: string;
  kind: RecommendationCandidateKind;
  protocol: RecommendationProtocol;
  nativeId: string;
  provider?: string;
  uri?: string;
  verification: RecommendationCandidateVerification;
  availability: RecommendationCandidateAvailabilityState;
  observedAt: string;
  metadata: RecommendationCandidateMetadata;
  provenance: readonly RecommendationCandidateProvenance[];
}

const CANDIDATE_KIND_SET = new Set<string>(RECOMMENDATION_CANDIDATE_KINDS);
const VERIFICATION_STATE_SET = new Set<string>(RECOMMENDATION_CANDIDATE_VERIFICATION_STATES);
const AVAILABILITY_STATE_SET = new Set<string>(RECOMMENDATION_CANDIDATE_AVAILABILITY_STATES);
const PROVENANCE_KIND_SET = new Set<string>(RECOMMENDATION_CANDIDATE_PROVENANCE_KINDS);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const TRUST_BOUNDARY_SET = new Set<string>(RECOMMENDATION_SOURCE_TRUST_BOUNDARIES);

const MAX_CANDIDATE_ID_LENGTH = 128;
const MAX_NATIVE_ID_LENGTH = 2_048;
const MAX_PROVIDER_LENGTH = 256;
const MAX_URI_LENGTH = 2_048;
const MAX_AUTHORITY_LENGTH = 512;
const MAX_SOURCE_ID_LENGTH = 256;
const MAX_SOURCE_ITEM_ID_LENGTH = 2_048;
const MAX_CURATOR_LENGTH = 512;
const MAX_DISPLAY_NAME_LENGTH = 512;
const MAX_SUMMARY_LENGTH = 4_096;
const MAX_METADATA_VALUE_LENGTH = 512;
const MAX_METADATA_VALUES = 128;
const MAX_PROVENANCE = 32;

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

function timestamp(value: unknown, message: string): string {
  return normalizeStrictRfc3339Timestamp(value, message);
}

function optionalTimestamp(value: unknown, message: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, message);
}

function httpsUrl(value: unknown, message: string): string {
  const raw = boundedString(value, MAX_URI_LENGTH, message);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(message);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(message);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeStringSet(
  value: unknown,
  message: string,
  maximumValues = MAX_METADATA_VALUES,
  maximumLength = MAX_METADATA_VALUE_LENGTH
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumValues) throw new TypeError(message);
  const normalized = value.map((entry) => boundedString(entry, maximumLength, message));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(message);
  return Object.freeze([...normalized].sort((left, right) => left.localeCompare(right)));
}

function isCandidateKind(value: unknown): value is RecommendationCandidateKind {
  return typeof value === "string" && CANDIDATE_KIND_SET.has(value);
}

function isProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
}

function isVerificationState(value: unknown): value is RecommendationCandidateVerificationState {
  return typeof value === "string" && VERIFICATION_STATE_SET.has(value);
}

function isAvailabilityState(value: unknown): value is RecommendationCandidateAvailabilityState {
  return typeof value === "string" && AVAILABILITY_STATE_SET.has(value);
}

function isProvenanceKind(value: unknown): value is RecommendationCandidateProvenanceKind {
  return typeof value === "string" && PROVENANCE_KIND_SET.has(value);
}

function isTrustBoundary(value: unknown): value is RecommendationSourceTrustBoundary {
  return typeof value === "string" && TRUST_BOUNDARY_SET.has(value);
}

function canonicalNativeId(kind: RecommendationCandidateKind, value: unknown): string {
  const nativeId = boundedString(value, MAX_NATIVE_ID_LENGTH, "Invalid recommendation candidate native identity.");
  if (kind === "hashtag") {
    const canonical = normalizeHashtag(nativeId);
    if (canonical.length === 0 || nativeId !== canonical) {
      throw new TypeError("Recommendation hashtag candidate identity must be canonical and hashless.");
    }
  }
  return nativeId;
}

export function createRecommendationCandidateId(input: RecommendationCandidateIdentityInput): string {
  if (!isRecord(input) || !isCandidateKind(input.kind) || !isProtocol(input.protocol)) {
    throw new TypeError("Invalid recommendation candidate identity input.");
  }
  const nativeId = canonicalNativeId(input.kind, input.nativeId);
  const provider = optionalBoundedString(input.provider, MAX_PROVIDER_LENGTH, "Invalid recommendation candidate provider.");
  const material = JSON.stringify([
    "recommendation-candidate.v1",
    input.kind,
    input.protocol,
    provider ?? "",
    nativeId
  ]);
  return `candidate:v1:${sha256Hex(material)}`;
}

export function normalizeRecommendationCandidateVerification(
  value: unknown
): RecommendationCandidateVerification {
  if (!isRecord(value) || !isVerificationState(value.state)) {
    throw new TypeError("Invalid recommendation candidate verification.");
  }
  const authority = optionalBoundedString(
    value.authority,
    MAX_AUTHORITY_LENGTH,
    "Invalid recommendation candidate verification authority."
  );
  const verifiedAt = optionalTimestamp(
    value.verifiedAt,
    "Invalid recommendation candidate verification timestamp."
  );

  if (value.state === "unverified_hint" && (authority !== undefined || verifiedAt !== undefined)) {
    throw new TypeError("Unverified recommendation candidate cannot carry verification authority.");
  }
  if (
    (value.state === "authority_verified" || value.state === "canonical") &&
    (authority === undefined || verifiedAt === undefined)
  ) {
    throw new TypeError("Verified recommendation candidate requires authority and timestamp.");
  }

  const normalized: RecommendationCandidateVerification = { state: value.state };
  if (authority !== undefined) normalized.authority = authority;
  if (verifiedAt !== undefined) normalized.verifiedAt = verifiedAt;
  return Object.freeze(normalized);
}

export function normalizeRecommendationCandidateProvenance(
  value: unknown
): RecommendationCandidateProvenance {
  if (!isRecord(value) || !isProvenanceKind(value.kind) || !isTrustBoundary(value.trustBoundary)) {
    throw new TypeError("Invalid recommendation candidate provenance.");
  }
  const sourceId = boundedString(value.sourceId, MAX_SOURCE_ID_LENGTH, "Invalid recommendation candidate provenance source ID.");
  const observedAt = timestamp(value.observedAt, "Invalid recommendation candidate provenance timestamp.");
  const sourceItemId = optionalBoundedString(
    value.sourceItemId,
    MAX_SOURCE_ITEM_ID_LENGTH,
    "Invalid recommendation candidate provenance source item ID."
  );
  const curator = optionalBoundedString(
    value.curator,
    MAX_CURATOR_LENGTH,
    "Invalid recommendation candidate provenance curator."
  );
  const sourceUrl = value.sourceUrl === undefined
    ? undefined
    : httpsUrl(value.sourceUrl, "Invalid recommendation candidate provenance source URL.");

  if (value.kind === "third_party_directory_hint" && value.trustBoundary !== "third_party") {
    throw new TypeError("Third-party candidate hint must retain third-party trust provenance.");
  }

  const normalized: RecommendationCandidateProvenance = {
    kind: value.kind,
    sourceId,
    observedAt,
    trustBoundary: value.trustBoundary
  };
  if (sourceItemId !== undefined) normalized.sourceItemId = sourceItemId;
  if (curator !== undefined) normalized.curator = curator;
  if (sourceUrl !== undefined) normalized.sourceUrl = sourceUrl;
  return Object.freeze(normalized);
}

function provenanceKey(value: RecommendationCandidateProvenance): string {
  return JSON.stringify([
    value.kind,
    value.sourceId,
    value.sourceItemId ?? "",
    value.curator ?? "",
    value.sourceUrl ?? ""
  ]);
}

function normalizeProvenanceList(value: unknown): readonly RecommendationCandidateProvenance[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROVENANCE) {
    throw new TypeError("Invalid recommendation candidate provenance list.");
  }
  const normalized = value.map((entry) => normalizeRecommendationCandidateProvenance(entry));
  const seen = new Set<string>();
  for (const entry of normalized) {
    const key = provenanceKey(entry);
    if (seen.has(key)) throw new TypeError("Duplicate recommendation candidate provenance.");
    seen.add(key);
  }
  normalized.sort((left, right) => {
    const keyOrder = provenanceKey(left).localeCompare(provenanceKey(right));
    return keyOrder !== 0 ? keyOrder : left.observedAt.localeCompare(right.observedAt);
  });
  return Object.freeze(normalized);
}

export function normalizeRecommendationCandidateMetadata(value: unknown): RecommendationCandidateMetadata {
  if (!isRecord(value)) throw new TypeError("Invalid recommendation candidate metadata.");
  const displayName = optionalBoundedString(
    value.displayName,
    MAX_DISPLAY_NAME_LENGTH,
    "Invalid recommendation candidate display name."
  );
  const summary = optionalBoundedString(
    value.summary,
    MAX_SUMMARY_LENGTH,
    "Invalid recommendation candidate summary."
  );
  const canonicalInterestIds = normalizeStringSet(
    value.canonicalInterestIds,
    "Invalid recommendation candidate canonical interests."
  );
  const tags = normalizeStringSet(value.tags, "Invalid recommendation candidate tags.");
  const entityIds = normalizeStringSet(value.entityIds, "Invalid recommendation candidate entities.");
  const languages = normalizeStringSet(value.languages, "Invalid recommendation candidate languages.", 32, 64);

  const normalized: RecommendationCandidateMetadata = {
    canonicalInterestIds,
    tags,
    entityIds,
    languages
  };
  if (displayName !== undefined) normalized.displayName = displayName;
  if (summary !== undefined) normalized.summary = summary;
  return Object.freeze(normalized);
}

export function normalizeRecommendationCandidate(value: unknown): RecommendationCandidate {
  if (
    !isRecord(value) ||
    !isCandidateKind(value.kind) ||
    !isProtocol(value.protocol) ||
    !isAvailabilityState(value.availability)
  ) {
    throw new TypeError("Invalid recommendation candidate.");
  }

  const candidateId = boundedString(value.candidateId, MAX_CANDIDATE_ID_LENGTH, "Invalid recommendation candidate ID.");
  const nativeId = canonicalNativeId(value.kind, value.nativeId);
  const provider = optionalBoundedString(value.provider, MAX_PROVIDER_LENGTH, "Invalid recommendation candidate provider.");
  const expectedId = createRecommendationCandidateId({
    kind: value.kind,
    protocol: value.protocol,
    nativeId,
    ...(provider === undefined ? {} : { provider })
  });
  if (candidateId !== expectedId) throw new TypeError("Recommendation candidate ID does not match canonical identity.");

  const uri = value.uri === undefined ? undefined : httpsUrl(value.uri, "Invalid recommendation candidate URI.");
  const verification = normalizeRecommendationCandidateVerification(value.verification);
  const observedAt = timestamp(value.observedAt, "Invalid recommendation candidate observation timestamp.");
  const metadata = normalizeRecommendationCandidateMetadata(value.metadata);
  const provenance = normalizeProvenanceList(value.provenance);

  if (
    verification.state === "authority_verified" || verification.state === "canonical"
  ) {
    const onlyUntrusted = provenance.every((entry) =>
      entry.trustBoundary === "third_party" || entry.trustBoundary === "unknown"
    );
    if (onlyUntrusted) {
      throw new TypeError("Verified recommendation candidate requires non-third-party provenance.");
    }
  }

  const normalized: RecommendationCandidate = {
    candidateId,
    kind: value.kind,
    protocol: value.protocol,
    nativeId,
    verification,
    availability: value.availability,
    observedAt,
    metadata,
    provenance
  };
  if (provider !== undefined) normalized.provider = provider;
  if (uri !== undefined) normalized.uri = uri;
  return Object.freeze(normalized);
}

export function normalizeRecommendationCandidateSet(
  value: unknown,
  maximum = 10_000
): readonly RecommendationCandidate[] {
  if (
    !Array.isArray(value) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 100_000 ||
    value.length > maximum
  ) {
    throw new TypeError("Invalid recommendation candidate set.");
  }
  const normalized = value.map((candidate) => normalizeRecommendationCandidate(candidate));
  const seen = new Set<string>();
  for (const candidate of normalized) {
    if (seen.has(candidate.candidateId)) throw new TypeError("Duplicate recommendation candidate ID.");
    seen.add(candidate.candidateId);
  }
  return Object.freeze(normalized);
}
