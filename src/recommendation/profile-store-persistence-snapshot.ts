import {
  RECOMMENDATION_PROTOCOLS,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import {
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  RECOMMENDATION_INTEREST_TARGET_KINDS,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestTarget,
  type RecommendationInterestTargetKind
} from "./interest-signal.js";
import {
  RECOMMENDATION_PROFILE_SCHEMA_VERSION,
  type RecommendationProfileEntry,
  type RecommendationProfileSnapshot
} from "./profile-store.js";
import type { RecommendationProfileStoreRecordParseOptions } from "./profile-store-persistence.js";

interface TimestampParseResult {
  value: string;
  millis: number;
}

interface NormalizedEntryResult {
  entry: RecommendationProfileEntry;
  signalCount: number;
  expiresAtMillis: number | undefined;
}

const MAX_TARGET_KEY_LENGTH = 160;
const TARGET_KIND_SET = new Set<string>(RECOMMENDATION_INTEREST_TARGET_KINDS);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const SOURCE_VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ENTRY_KEYS = new Set([
  "target",
  "score",
  "confidence",
  "signalCount",
  "positiveSignalCount",
  "negativeSignalCount",
  "neutralSignalCount",
  "privacyBoundaries",
  "protocols",
  "sourceVisibilities",
  "updatedAt",
  "expiresAt"
]);
const TARGET_KEYS = new Set(["kind", "key"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
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

function isPrivacySafeTargetKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= MAX_TARGET_KEY_LENGTH &&
    !value.includes("://") &&
    !value.includes("@") &&
    !hasControlCharacter(value)
  );
}

function normalizeTarget(value: unknown): RecommendationInterestTarget {
  if (!isObject(value) || !hasOnlyKeys(value, TARGET_KEYS)) {
    throw new TypeError("Invalid recommendation profile target.");
  }

  const kind = value.kind;
  const key = value.key;
  if (typeof kind !== "string" || !TARGET_KIND_SET.has(kind) || !isPrivacySafeTargetKey(key)) {
    throw new TypeError("Invalid recommendation profile target.");
  }

  return Object.freeze({ kind: kind as RecommendationInterestTargetKind, key });
}

function normalizeEnumArray<T extends string>(
  value: unknown,
  knownValues: ReadonlySet<string>,
  message: string
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(message);
  }

  const normalized = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string" || !knownValues.has(item)) {
      throw new TypeError(message);
    }
    normalized.add(item as T);
  }

  return Object.freeze([...normalized].sort());
}

function normalizeEntry(value: unknown): NormalizedEntryResult {
  if (!isObject(value) || !hasOnlyKeys(value, ENTRY_KEYS)) {
    throw new TypeError("Invalid recommendation profile entry.");
  }

  const signalCount = value.signalCount;
  const positiveSignalCount = value.positiveSignalCount;
  const negativeSignalCount = value.negativeSignalCount;
  const neutralSignalCount = value.neutralSignalCount;

  if (
    !isNonNegativeSafeInteger(signalCount) ||
    !isNonNegativeSafeInteger(positiveSignalCount) ||
    !isNonNegativeSafeInteger(negativeSignalCount) ||
    !isNonNegativeSafeInteger(neutralSignalCount) ||
    positiveSignalCount + negativeSignalCount + neutralSignalCount !== signalCount ||
    !isBoundedNumber(value.score, -1, 1) ||
    !isBoundedNumber(value.confidence, 0, 1)
  ) {
    throw new TypeError("Invalid recommendation profile entry counters.");
  }

  const updatedAt = assertTimestamp(value.updatedAt, "Invalid recommendation profile timestamp.").value;
  const expiresAt = value.expiresAt === undefined
    ? undefined
    : assertTimestamp(value.expiresAt, "Invalid recommendation profile timestamp.").value;
  const entry: RecommendationProfileEntry = {
    target: normalizeTarget(value.target),
    score: value.score,
    confidence: value.confidence,
    signalCount,
    positiveSignalCount,
    negativeSignalCount,
    neutralSignalCount,
    privacyBoundaries: normalizeEnumArray<RecommendationInterestPrivacyBoundary>(
      value.privacyBoundaries,
      PRIVACY_BOUNDARY_SET,
      "Invalid recommendation profile privacy boundary summary."
    ),
    protocols: normalizeEnumArray<RecommendationProtocol>(
      value.protocols,
      PROTOCOL_SET,
      "Invalid recommendation profile protocol summary."
    ),
    sourceVisibilities: normalizeEnumArray<RecommendationSourceVisibility>(
      value.sourceVisibilities,
      SOURCE_VISIBILITY_SET,
      "Invalid recommendation profile source visibility summary."
    ),
    updatedAt
  };

  if (expiresAt !== undefined) {
    entry.expiresAt = expiresAt;
  }

  return {
    entry: Object.freeze(entry),
    signalCount,
    expiresAtMillis: expiresAt === undefined ? undefined : Date.parse(expiresAt)
  };
}

function compareTargets(left: RecommendationInterestTarget, right: RecommendationInterestTarget): number {
  return left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key);
}

function compareProfileEntries(left: RecommendationProfileEntry, right: RecommendationProfileEntry): number {
  return Math.abs(right.score) - Math.abs(left.score) || compareTargets(left.target, right.target);
}

function maxTimestamp(left: TimestampParseResult, right: TimestampParseResult): string {
  return left.millis >= right.millis ? left.value : right.value;
}

export function normalizeRecommendationProfileSnapshot(
  value: unknown,
  options: RecommendationProfileStoreRecordParseOptions = {}
): RecommendationProfileSnapshot {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation profile snapshot.");
  }

  if (value.schemaVersion !== RECOMMENDATION_PROFILE_SCHEMA_VERSION || !Array.isArray(value.entries)) {
    throw new TypeError("Invalid recommendation profile snapshot.");
  }

  if (!isNonNegativeSafeInteger(value.signalCount)) {
    throw new TypeError("Invalid recommendation profile signal count.");
  }

  const updatedAt = assertTimestamp(value.updatedAt, "Invalid recommendation profile timestamp.");
  const now = options.now === undefined ? undefined : assertTimestamp(options.now, "Invalid recommendation profile timestamp.");
  const shouldPrune = options.pruneExpiredEntries !== false && now !== undefined;
  const activeEntries: RecommendationProfileEntry[] = [];
  let originalSignalCount = 0;
  let activeSignalCount = 0;
  let prunedExpiredEntry = false;

  for (const rawEntry of value.entries) {
    const normalized = normalizeEntry(rawEntry);
    originalSignalCount += normalized.signalCount;

    if (shouldPrune && normalized.expiresAtMillis !== undefined && normalized.expiresAtMillis <= now.millis) {
      prunedExpiredEntry = true;
      continue;
    }

    activeSignalCount += normalized.signalCount;
    activeEntries.push(normalized.entry);
  }

  if (value.signalCount !== originalSignalCount) {
    throw new TypeError("Invalid recommendation profile aggregate signal count.");
  }

  activeEntries.sort(compareProfileEntries);
  return Object.freeze({
    schemaVersion: RECOMMENDATION_PROFILE_SCHEMA_VERSION,
    updatedAt: prunedExpiredEntry && now !== undefined ? maxTimestamp(updatedAt, now) : updatedAt.value,
    signalCount: activeSignalCount,
    entries: Object.freeze(activeEntries)
  });
}

export function createEmptyRecommendationProfileSnapshot(updatedAt: string): RecommendationProfileSnapshot {
  return Object.freeze({
    schemaVersion: RECOMMENDATION_PROFILE_SCHEMA_VERSION,
    updatedAt: assertTimestamp(updatedAt, "Invalid recommendation profile timestamp.").value,
    signalCount: 0,
    entries: Object.freeze([])
  });
}