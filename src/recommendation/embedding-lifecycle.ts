import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import {
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  type RecommendationInterestPrivacyBoundary
} from "./interest-signal.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import {
  assertValidRecommendationProfileSubjectKey,
  createRecommendationProfileSubjectKey,
  type RecommendationProfileSubjectKeyInput,
  normalizeRecommendationProfileSnapshot
} from "./profile-store-persistence.js";
import { sha256Hex } from "../runtime/hash.js";

export const RECOMMENDATION_EMBEDDING_RECORD_SCHEMA_VERSION = "recommendation-embedding-record.v1" as const;
export const RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION = "recommendation-embedding-model.v1" as const;
export const RECOMMENDATION_EMBEDDING_SOURCE_SCHEMA_VERSION = "recommendation-embedding-source.v1" as const;

export const RECOMMENDATION_EMBEDDING_DISTANCE_METRICS = ["cosine", "dot", "euclidean"] as const;
export type RecommendationEmbeddingDistanceMetric = typeof RECOMMENDATION_EMBEDDING_DISTANCE_METRICS[number];

export const RECOMMENDATION_EMBEDDING_INVALIDATION_REASONS = [
  "deletion_requested",
  "consent_revoked",
  "profile_replaced",
  "model_retired"
] as const;
export type RecommendationEmbeddingInvalidationReason = typeof RECOMMENDATION_EMBEDDING_INVALIDATION_REASONS[number];

export const RECOMMENDATION_EMBEDDING_STALENESS_REASONS = [
  "invalidated",
  "expired",
  "model_changed",
  "profile_changed",
  "privacy_boundary_changed",
  "dimension_mismatch"
] as const;
export type RecommendationEmbeddingStalenessReason = typeof RECOMMENDATION_EMBEDDING_STALENESS_REASONS[number];

export interface RecommendationEmbeddingArtifactIntegrity {
  artifactRef: string;
  sha256: string;
  sizeBytes?: number;
}

export interface RecommendationEmbeddingModelManifest {
  schemaVersion: typeof RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION;
  providerId: string;
  modelId: string;
  modelVersion: string;
  dimensions: number;
  distanceMetric: RecommendationEmbeddingDistanceMetric;
  artifact?: RecommendationEmbeddingArtifactIntegrity;
}

export interface RecommendationEmbeddingSourceFingerprint {
  schemaVersion: typeof RECOMMENDATION_EMBEDDING_SOURCE_SCHEMA_VERSION;
  profileUpdatedAt: string;
  profileSignalCount: number;
  profileDigest: string;
}

export interface RecommendationEmbeddingRecord {
  schemaVersion: typeof RECOMMENDATION_EMBEDDING_RECORD_SCHEMA_VERSION;
  embeddingId: string;
  subjectKey: string;
  dataUse: "embeddings";
  privacyBoundary: RecommendationInterestPrivacyBoundary;
  model: RecommendationEmbeddingModelManifest;
  source: RecommendationEmbeddingSourceFingerprint;
  vector: readonly number[];
  createdAt: string;
  expiresAt?: string;
  invalidatedAt?: string;
  invalidationReason?: RecommendationEmbeddingInvalidationReason;
}

export interface RecommendationEmbeddingRecordInput extends RecommendationProfileSubjectKeyInput {
  model: RecommendationEmbeddingModelManifest;
  profile: RecommendationProfileSnapshot;
  vector: readonly number[];
  createdAt: string;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  expiresAt?: string;
}

export interface RecommendationEmbeddingRecordParseOptions {
  now?: string;
  includeInvalidated?: boolean;
}

export interface RecommendationEmbeddingFreshnessInput {
  record: RecommendationEmbeddingRecord;
  model: RecommendationEmbeddingModelManifest;
  profile: RecommendationProfileSnapshot;
  now?: string;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
}

export interface RecommendationEmbeddingFreshnessEvaluation {
  stale: boolean;
  reasons: readonly RecommendationEmbeddingStalenessReason[];
}

export interface RecommendationEmbeddingInvalidationInput {
  record: RecommendationEmbeddingRecord;
  intent: RecommendationDerivedDataDeletionIntent;
  namespace?: string;
  salt?: string;
  reason?: RecommendationEmbeddingInvalidationReason;
}

const MAX_SAFE_STRING_LENGTH = 512;
const MAX_ARTIFACT_REF_LENGTH = 1_024;
const MAX_VECTOR_DIMENSIONS = 16_384;
const SHA256_HEX_LENGTH = 64;
const EMBEDDING_ID_PREFIX = "embedding:";
const DISTANCE_METRIC_SET = new Set<string>(RECOMMENDATION_EMBEDDING_DISTANCE_METRICS);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);
const INVALIDATION_REASON_SET = new Set<string>(RECOMMENDATION_EMBEDDING_INVALIDATION_REASONS);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSafeString(value: unknown, message: string, maxLength = MAX_SAFE_STRING_LENGTH): string {
  if (
    !isNonEmptyString(value) ||
    value.trim() !== value ||
    value.length > maxLength ||
    hasControlCharacter(value)
  ) {
    throw new TypeError(message);
  }

  return value;
}

function assertTimestamp(value: unknown, message = "Invalid recommendation embedding timestamp."): { value: string; millis: number } {
  const timestamp = assertSafeString(value, message);
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) {
    throw new TypeError(message);
  }

  return { value: timestamp, millis };
}

function isSha256Hex(value: string): boolean {
  if (value.length !== SHA256_HEX_LENGTH) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    if (!isDigit && !isLowerHex) {
      return false;
    }
  }

  return true;
}

function assertSha256Hex(value: unknown, message: string): string {
  if (typeof value !== "string" || !isSha256Hex(value)) {
    throw new TypeError(message);
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Cannot canonicalize non-finite recommendation embedding metadata.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isObject(value)) {
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${stableStringify(item)}`);
    }
    return `{${entries.join(",")}}`;
  }

  throw new TypeError("Cannot canonicalize unsupported recommendation embedding metadata.");
}

function normalizeSubjectKey(value: unknown): string {
  assertValidRecommendationProfileSubjectKey(value);
  return value;
}

function normalizeEmbeddingId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(EMBEDDING_ID_PREFIX) ||
    !isSha256Hex(value.slice(EMBEDDING_ID_PREFIX.length))
  ) {
    throw new TypeError("Invalid recommendation embedding id.");
  }

  return value;
}

function assertPositiveInteger(value: unknown, message: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(message);
  }

  return value;
}

function assertNonNegativeInteger(value: unknown, message: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new TypeError(message);
  }

  return value;
}

function assertOptionalNonNegativeInteger(value: unknown, message: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonNegativeInteger(value, message, Number.MAX_SAFE_INTEGER);
}

function assertPrivacyBoundary(value: unknown): RecommendationInterestPrivacyBoundary {
  if (typeof value !== "string" || !PRIVACY_BOUNDARY_SET.has(value)) {
    throw new TypeError("Invalid recommendation embedding privacy boundary.");
  }

  return value as RecommendationInterestPrivacyBoundary;
}

function assertDistanceMetric(value: unknown): RecommendationEmbeddingDistanceMetric {
  if (typeof value !== "string" || !DISTANCE_METRIC_SET.has(value)) {
    throw new TypeError("Invalid recommendation embedding distance metric.");
  }

  return value as RecommendationEmbeddingDistanceMetric;
}

function assertInvalidationReason(value: unknown): RecommendationEmbeddingInvalidationReason {
  if (typeof value !== "string" || !INVALIDATION_REASON_SET.has(value)) {
    throw new TypeError("Invalid recommendation embedding invalidation reason.");
  }

  return value as RecommendationEmbeddingInvalidationReason;
}

function normalizeArtifactIntegrity(value: unknown): RecommendationEmbeddingArtifactIntegrity | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation embedding artifact integrity.");
  }

  const artifact: RecommendationEmbeddingArtifactIntegrity = {
    artifactRef: assertSafeString(value.artifactRef, "Invalid recommendation embedding artifact reference.", MAX_ARTIFACT_REF_LENGTH),
    sha256: assertSha256Hex(value.sha256, "Invalid recommendation embedding artifact digest.")
  };
  const sizeBytes = assertOptionalNonNegativeInteger(value.sizeBytes, "Invalid recommendation embedding artifact size.");
  if (sizeBytes !== undefined) {
    artifact.sizeBytes = sizeBytes;
  }

  return Object.freeze(artifact);
}

export function normalizeRecommendationEmbeddingModelManifest(
  value: unknown
): RecommendationEmbeddingModelManifest {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation embedding model manifest.");
  }

  if (value.schemaVersion !== RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION) {
    throw new TypeError("Invalid recommendation embedding model schema version.");
  }

  const model: RecommendationEmbeddingModelManifest = {
    schemaVersion: RECOMMENDATION_EMBEDDING_MODEL_SCHEMA_VERSION,
    providerId: assertSafeString(value.providerId, "Invalid recommendation embedding provider id."),
    modelId: assertSafeString(value.modelId, "Invalid recommendation embedding model id."),
    modelVersion: assertSafeString(value.modelVersion, "Invalid recommendation embedding model version."),
    dimensions: assertPositiveInteger(value.dimensions, "Invalid recommendation embedding dimensions.", MAX_VECTOR_DIMENSIONS),
    distanceMetric: assertDistanceMetric(value.distanceMetric)
  };

  const artifact = normalizeArtifactIntegrity(value.artifact);
  if (artifact !== undefined) {
    model.artifact = artifact;
  }

  return Object.freeze(model);
}

function normalizeVector(value: unknown, dimensions: number): readonly number[] {
  if (!Array.isArray(value) || value.length !== dimensions || value.length > MAX_VECTOR_DIMENSIONS) {
    throw new TypeError("Invalid recommendation embedding vector dimensions.");
  }

  const vector = value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new TypeError("Invalid recommendation embedding vector value.");
    }
    return item;
  });

  return Object.freeze(vector);
}

export function createRecommendationEmbeddingSourceFingerprint(
  profile: RecommendationProfileSnapshot
): RecommendationEmbeddingSourceFingerprint {
  const normalizedProfile = normalizeRecommendationProfileSnapshot(profile, { pruneExpiredEntries: false });
  const serializedProfile = stableStringify(normalizedProfile);
  return Object.freeze({
    schemaVersion: RECOMMENDATION_EMBEDDING_SOURCE_SCHEMA_VERSION,
    profileUpdatedAt: normalizedProfile.updatedAt,
    profileSignalCount: normalizedProfile.signalCount,
    profileDigest: sha256Hex(serializedProfile)
  });
}

function normalizeSourceFingerprint(value: unknown): RecommendationEmbeddingSourceFingerprint {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation embedding source fingerprint.");
  }

  if (value.schemaVersion !== RECOMMENDATION_EMBEDDING_SOURCE_SCHEMA_VERSION) {
    throw new TypeError("Invalid recommendation embedding source schema version.");
  }

  return Object.freeze({
    schemaVersion: RECOMMENDATION_EMBEDDING_SOURCE_SCHEMA_VERSION,
    profileUpdatedAt: assertTimestamp(value.profileUpdatedAt).value,
    profileSignalCount: assertNonNegativeInteger(
      value.profileSignalCount,
      "Invalid recommendation embedding source signal count.",
      Number.MAX_SAFE_INTEGER
    ),
    profileDigest: assertSha256Hex(value.profileDigest, "Invalid recommendation embedding source digest.")
  });
}

function modelIdentityParts(model: RecommendationEmbeddingModelManifest): readonly unknown[] {
  const artifact = model.artifact;
  return [
    "recommendation-embedding-model-identity.v1",
    model.providerId,
    model.modelId,
    model.modelVersion,
    model.dimensions,
    model.distanceMetric,
    artifact === undefined
      ? null
      : {
        artifactRef: artifact.artifactRef,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes ?? null
      }
  ];
}

function createEmbeddingId(subjectKey: string, model: RecommendationEmbeddingModelManifest, source: RecommendationEmbeddingSourceFingerprint): string {
  return `embedding:${sha256Hex(stableStringify([
    "recommendation-embedding-id.v1",
    subjectKey,
    modelIdentityParts(model),
    source.profileDigest
  ]))}`;
}

function createLegacyEmbeddingId(
  subjectKey: string,
  model: RecommendationEmbeddingModelManifest,
  source: RecommendationEmbeddingSourceFingerprint
): string {
  return `embedding:${sha256Hex(JSON.stringify([
    "recommendation-embedding-id.v1",
    subjectKey,
    model.providerId,
    model.modelId,
    model.modelVersion,
    model.dimensions,
    source.profileDigest
  ]))}`;
}

function isSupportedEmbeddingId(
  embeddingId: string,
  subjectKey: string,
  model: RecommendationEmbeddingModelManifest,
  source: RecommendationEmbeddingSourceFingerprint
): boolean {
  return embeddingId === createEmbeddingId(subjectKey, model, source) ||
    embeddingId === createLegacyEmbeddingId(subjectKey, model, source);
}

export function createRecommendationEmbeddingRecord(input: RecommendationEmbeddingRecordInput): RecommendationEmbeddingRecord {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation embedding record input.");
  }

  const model = normalizeRecommendationEmbeddingModelManifest(input.model);
  const source = createRecommendationEmbeddingSourceFingerprint(input.profile);
  const vector = normalizeVector(input.vector, model.dimensions);
  const createdAt = assertTimestamp(input.createdAt).value;
  const expiresAt = input.expiresAt === undefined ? undefined : assertTimestamp(input.expiresAt).value;
  const subjectKey = createRecommendationProfileSubjectKey(input);
  const record: RecommendationEmbeddingRecord = {
    schemaVersion: RECOMMENDATION_EMBEDDING_RECORD_SCHEMA_VERSION,
    embeddingId: createEmbeddingId(subjectKey, model, source),
    subjectKey,
    dataUse: "embeddings",
    privacyBoundary: input.privacyBoundary === undefined ? "local_only" : assertPrivacyBoundary(input.privacyBoundary),
    model,
    source,
    vector,
    createdAt
  };

  if (expiresAt !== undefined) {
    record.expiresAt = expiresAt;
  }

  return Object.freeze(record);
}

export function normalizeRecommendationEmbeddingRecord(
  value: unknown,
  options: RecommendationEmbeddingRecordParseOptions = {}
): RecommendationEmbeddingRecord | null {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation embedding record.");
  }

  if (value.schemaVersion !== RECOMMENDATION_EMBEDDING_RECORD_SCHEMA_VERSION || value.dataUse !== "embeddings") {
    throw new TypeError("Invalid recommendation embedding record schema.");
  }

  const model = normalizeRecommendationEmbeddingModelManifest(value.model);
  const source = normalizeSourceFingerprint(value.source);
  const vector = normalizeVector(value.vector, model.dimensions);
  const subjectKey = normalizeSubjectKey(value.subjectKey);
  const embeddingId = normalizeEmbeddingId(value.embeddingId);
  if (!isSupportedEmbeddingId(embeddingId, subjectKey, model, source)) {
    throw new TypeError("Invalid recommendation embedding id.");
  }

  const createdAt = assertTimestamp(value.createdAt).value;
  const now = options.now === undefined ? undefined : assertTimestamp(options.now).millis;
  const expiresAt = value.expiresAt === undefined ? undefined : assertTimestamp(value.expiresAt).value;
  const invalidatedAt = value.invalidatedAt === undefined ? undefined : assertTimestamp(value.invalidatedAt).value;
  const invalidationReason = value.invalidationReason === undefined
    ? undefined
    : assertInvalidationReason(value.invalidationReason);

  if (expiresAt !== undefined && now !== undefined && Date.parse(expiresAt) <= now) {
    return null;
  }

  if (invalidatedAt !== undefined && options.includeInvalidated !== true) {
    return null;
  }

  if ((invalidatedAt === undefined) !== (invalidationReason === undefined)) {
    throw new TypeError("Invalid recommendation embedding invalidation state.");
  }

  const record: RecommendationEmbeddingRecord = {
    schemaVersion: RECOMMENDATION_EMBEDDING_RECORD_SCHEMA_VERSION,
    embeddingId,
    subjectKey,
    dataUse: "embeddings",
    privacyBoundary: assertPrivacyBoundary(value.privacyBoundary),
    model,
    source,
    vector,
    createdAt
  };

  if (expiresAt !== undefined) {
    record.expiresAt = expiresAt;
  }
  if (invalidatedAt !== undefined && invalidationReason !== undefined) {
    record.invalidatedAt = invalidatedAt;
    record.invalidationReason = invalidationReason;
  }

  return Object.freeze(record);
}

export function serializeRecommendationEmbeddingRecord(record: RecommendationEmbeddingRecord): string {
  const normalized = normalizeRecommendationEmbeddingRecord(record, { includeInvalidated: true });
  if (normalized === null) {
    throw new TypeError("Invalid recommendation embedding record.");
  }

  return JSON.stringify(normalized);
}

export function deserializeRecommendationEmbeddingRecord(
  serialized: string,
  options: RecommendationEmbeddingRecordParseOptions = {}
): RecommendationEmbeddingRecord | null {
  if (!isNonEmptyString(serialized)) {
    throw new TypeError("Invalid recommendation embedding record serialization.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("Invalid recommendation embedding record serialization.");
  }

  return normalizeRecommendationEmbeddingRecord(parsed, options);
}

function sameModel(left: RecommendationEmbeddingModelManifest, right: RecommendationEmbeddingModelManifest): boolean {
  return stableStringify(modelIdentityParts(left)) === stableStringify(modelIdentityParts(right));
}

export function evaluateRecommendationEmbeddingFreshness(
  input: RecommendationEmbeddingFreshnessInput
): RecommendationEmbeddingFreshnessEvaluation {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation embedding freshness input.");
  }

  const record = normalizeRecommendationEmbeddingRecord(input.record, { includeInvalidated: true });
  if (record === null) {
    return Object.freeze({ stale: true, reasons: Object.freeze(["expired"] as const) });
  }

  const model = normalizeRecommendationEmbeddingModelManifest(input.model);
  const source = createRecommendationEmbeddingSourceFingerprint(input.profile);
  const reasons = new Set<RecommendationEmbeddingStalenessReason>();
  const now = input.now === undefined ? undefined : assertTimestamp(input.now).millis;

  if (record.invalidatedAt !== undefined) reasons.add("invalidated");
  if (record.expiresAt !== undefined && now !== undefined && Date.parse(record.expiresAt) <= now) reasons.add("expired");
  if (!sameModel(record.model, model)) reasons.add("model_changed");
  if (record.source.profileDigest !== source.profileDigest) reasons.add("profile_changed");
  if (record.vector.length !== model.dimensions) reasons.add("dimension_mismatch");
  if (input.privacyBoundary !== undefined && record.privacyBoundary !== assertPrivacyBoundary(input.privacyBoundary)) {
    reasons.add("privacy_boundary_changed");
  }

  const sortedReasons = RECOMMENDATION_EMBEDDING_STALENESS_REASONS.filter((reason) => reasons.has(reason));
  return Object.freeze({ stale: sortedReasons.length > 0, reasons: Object.freeze(sortedReasons) });
}

function assertProfileEmbeddingDeletionIntent(intent: RecommendationDerivedDataDeletionIntent): void {
  if (
    !isObject(intent) ||
    !isNonEmptyString(intent.subjectId) ||
    intent.scope !== "recommendation_derived_data" ||
    !Array.isArray(intent.targets) ||
    !intent.targets.includes("embeddings")
  ) {
    throw new TypeError("Invalid recommendation embedding deletion intent.");
  }

  assertTimestamp(intent.requestedAt);
}

export function invalidateRecommendationEmbeddingRecord(
  input: RecommendationEmbeddingInvalidationInput
): RecommendationEmbeddingRecord {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation embedding invalidation input.");
  }

  assertProfileEmbeddingDeletionIntent(input.intent);
  const record = normalizeRecommendationEmbeddingRecord(input.record, { includeInvalidated: true });
  if (record === null) {
    throw new TypeError("Invalid recommendation embedding record.");
  }

  const subjectKey = createRecommendationProfileSubjectKey({
    subjectId: input.intent.subjectId,
    ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    ...(input.salt === undefined ? {} : { salt: input.salt })
  });
  if (subjectKey !== record.subjectKey) {
    throw new TypeError("Recommendation embedding deletion intent subject does not match record.");
  }

  return Object.freeze({
    ...record,
    invalidatedAt: input.intent.requestedAt,
    invalidationReason: input.reason ?? "deletion_requested"
  });
}
