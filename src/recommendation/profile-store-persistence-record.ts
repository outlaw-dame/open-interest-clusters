import {
  RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION,
  type RecommendationProfileStoreRecord,
  type RecommendationProfileStoreRecordInput,
  type RecommendationProfileStoreRecordParseOptions
} from "./profile-store-persistence.js";
import {
  assertValidRecommendationProfileSubjectKey,
  createRecommendationProfileSubjectKey
} from "./profile-store-persistence-key.js";
import { normalizeRecommendationProfileSnapshot } from "./profile-store-persistence-snapshot.js";

const RECORD_KEYS = new Set(["schemaVersion", "subjectKey", "writtenAt", "profile", "expiresAt"]);

interface TimestampParseResult {
  value: string;
  millis: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertTimestamp(value: unknown, message: string): TimestampParseResult {
  if (!isNonEmptyString(value)) {
    throw new TypeError(message);
  }

  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new TypeError(message);
  }

  return { value, millis };
}

export function createRecommendationProfileStoreRecord(
  input: RecommendationProfileStoreRecordInput
): RecommendationProfileStoreRecord {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation profile store record input.");
  }

  const writtenAt = assertTimestamp(input.writtenAt, "Invalid recommendation profile timestamp.").value;
  const expiresAt = input.expiresAt === undefined
    ? undefined
    : assertTimestamp(input.expiresAt, "Invalid recommendation profile timestamp.").value;
  const record: RecommendationProfileStoreRecord = {
    schemaVersion: RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION,
    subjectKey: createRecommendationProfileSubjectKey(input),
    writtenAt,
    profile: normalizeRecommendationProfileSnapshot(input.profile)
  };

  if (expiresAt !== undefined) {
    record.expiresAt = expiresAt;
  }

  return Object.freeze(record);
}

export function normalizeRecommendationProfileStoreRecord(
  value: unknown,
  options: RecommendationProfileStoreRecordParseOptions = {}
): RecommendationProfileStoreRecord | null {
  if (!isObject(value) || !hasOnlyKeys(value, RECORD_KEYS)) {
    throw new TypeError("Invalid recommendation profile store record.");
  }

  if (value.schemaVersion !== RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION) {
    throw new TypeError("Invalid recommendation profile store record schema version.");
  }

  assertValidRecommendationProfileSubjectKey(value.subjectKey);
  const writtenAt = assertTimestamp(value.writtenAt, "Invalid recommendation profile timestamp.").value;
  const now = options.now === undefined ? undefined : assertTimestamp(options.now, "Invalid recommendation profile timestamp.");
  const expiresAt = value.expiresAt === undefined
    ? undefined
    : assertTimestamp(value.expiresAt, "Invalid recommendation profile timestamp.").value;

  if (expiresAt !== undefined && now !== undefined && Date.parse(expiresAt) <= now.millis) {
    return null;
  }

  const record: RecommendationProfileStoreRecord = {
    schemaVersion: RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION,
    subjectKey: value.subjectKey,
    writtenAt,
    profile: normalizeRecommendationProfileSnapshot(value.profile, options)
  };

  if (expiresAt !== undefined) {
    record.expiresAt = expiresAt;
  }

  return Object.freeze(record);
}

export function serializeRecommendationProfileStoreRecord(record: RecommendationProfileStoreRecord): string {
  const normalized = normalizeRecommendationProfileStoreRecord(record, { pruneExpiredEntries: false });
  if (normalized === null) {
    throw new TypeError("Invalid recommendation profile store record.");
  }

  return JSON.stringify(normalized);
}

export function deserializeRecommendationProfileStoreRecord(
  serialized: string,
  options: RecommendationProfileStoreRecordParseOptions = {}
): RecommendationProfileStoreRecord | null {
  if (!isNonEmptyString(serialized)) {
    throw new TypeError("Invalid recommendation profile store record serialization.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("Invalid recommendation profile store record serialization.");
  }

  return normalizeRecommendationProfileStoreRecord(parsed, options);
}
