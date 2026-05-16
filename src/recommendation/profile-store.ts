import type {
  RecommendationDerivedDataDeletionIntent,
  RecommendationProtocol,
  RecommendationSourceVisibility
} from "./consent.js";
import {
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  isRecommendationInterestSignal,
  normalizeRecommendationInterestSignal,
  type RecommendationInterestPolarity,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestSignal,
  type RecommendationInterestTarget
} from "./interest-signal.js";

export const RECOMMENDATION_PROFILE_SCHEMA_VERSION = "recommendation-profile.v1" as const;

export interface RecommendationProfileEntry {
  target: RecommendationInterestTarget;
  score: number;
  confidence: number;
  signalCount: number;
  positiveSignalCount: number;
  negativeSignalCount: number;
  neutralSignalCount: number;
  privacyBoundaries: readonly RecommendationInterestPrivacyBoundary[];
  protocols: readonly RecommendationProtocol[];
  sourceVisibilities: readonly RecommendationSourceVisibility[];
  updatedAt: string;
  expiresAt?: string;
}

export interface RecommendationProfileSnapshot {
  schemaVersion: typeof RECOMMENDATION_PROFILE_SCHEMA_VERSION;
  updatedAt: string;
  signalCount: number;
  entries: readonly RecommendationProfileEntry[];
}

export interface RecommendationProfileSignalIngestInput {
  subjectId: string;
  signals: readonly RecommendationInterestSignal[];
  now?: string;
}

export interface RecommendationProfileSignalIngestResult {
  acceptedSignalCount: number;
  skippedExpiredSignalCount: number;
  profile: RecommendationProfileSnapshot;
}

export interface RecommendationProfileStore {
  ingestSignals(input: RecommendationProfileSignalIngestInput): Promise<RecommendationProfileSignalIngestResult>;
  readProfile(subjectId: string): Promise<RecommendationProfileSnapshot>;
  deleteProfile(intent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationProfileSnapshot>;
}

export interface InMemoryRecommendationProfileStoreOptions {
  now?: () => string;
  maxEntries?: number;
  allowedPrivacyBoundaries?: readonly RecommendationInterestPrivacyBoundary[];
}

interface MutableProfileEntry {
  target: RecommendationInterestTarget;
  score: number;
  confidence: number;
  signalCount: number;
  positiveSignalCount: number;
  negativeSignalCount: number;
  neutralSignalCount: number;
  privacyBoundaries: Set<RecommendationInterestPrivacyBoundary>;
  protocols: Set<RecommendationProtocol>;
  sourceVisibilities: Set<RecommendationSourceVisibility>;
  updatedAt: string;
  expiresAt: string | undefined;
}

interface MutableProfileState {
  updatedAt: string;
  signalCount: number;
  entries: Map<string, MutableProfileEntry>;
}

interface NormalizedTimestamp {
  value: string;
  millis: number;
}

interface PreparedInterestSignal {
  signal: RecommendationInterestSignal;
  key: string;
  observedAtMillis: number;
  expiresAtMillis: number | undefined;
}

interface PreparedSignalBatch {
  acceptedSignals: PreparedInterestSignal[];
  skippedExpiredSignalCount: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_ENTRIES_UPPER_BOUND = 100_000;
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertValidSubjectId(subjectId: unknown): asserts subjectId is string {
  if (
    !isNonEmptyString(subjectId) ||
    subjectId.length > MAX_SUBJECT_ID_LENGTH ||
    /[\x00-\x1F\x7F]/u.test(subjectId)
  ) {
    throw new TypeError("Invalid recommendation profile subject id.");
  }
}

function timestampMillis(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("Invalid recommendation profile timestamp.");
  }

  return parsed;
}

function normalizeNow(value: string | undefined, fallback: () => string): NormalizedTimestamp {
  const timestamp = value ?? fallback();
  return { value: timestamp, millis: timestampMillis(timestamp) };
}

function maxTimestampWithRightMillis(left: string, right: string, rightMillis: number): string {
  return timestampMillis(left) >= rightMillis ? left : right;
}

function latestExpiration(
  left: string | undefined,
  right: string | undefined,
  rightMillis: number | undefined
): string | undefined {
  if (left === undefined || right === undefined || rightMillis === undefined) {
    return undefined;
  }

  return timestampMillis(left) >= rightMillis ? left : right;
}

function isExpiredTimestamp(expiresAt: string | undefined, nowMillis: number): boolean {
  if (expiresAt === undefined) {
    return false;
  }

  return timestampMillis(expiresAt) <= nowMillis;
}

function clampUnitScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}

function signalDelta(polarity: RecommendationInterestPolarity, strength: number, confidence: number): number {
  const magnitude = strength * confidence;
  if (polarity === "positive") {
    return magnitude;
  }

  if (polarity === "negative") {
    return -magnitude;
  }

  return 0;
}

function targetKey(target: RecommendationInterestTarget): string {
  return `${target.kind}:${target.key}`;
}

function compareTargets(left: RecommendationInterestTarget, right: RecommendationInterestTarget): number {
  return left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key);
}

function compareProfileEntries(left: MutableProfileEntry, right: MutableProfileEntry): number {
  return Math.abs(right.score) - Math.abs(left.score) || compareTargets(left.target, right.target);
}

function sortEntryRecords(entries: ReadonlyMap<string, MutableProfileEntry>): [string, MutableProfileEntry][] {
  return [...entries.entries()].sort((left, right) => compareProfileEntries(left[1], right[1]));
}

function cloneTarget(target: RecommendationInterestTarget): RecommendationInterestTarget {
  return Object.freeze({ kind: target.kind, key: target.key });
}

function cloneMutableEntry(entry: MutableProfileEntry): MutableProfileEntry {
  return {
    target: cloneTarget(entry.target),
    score: entry.score,
    confidence: entry.confidence,
    signalCount: entry.signalCount,
    positiveSignalCount: entry.positiveSignalCount,
    negativeSignalCount: entry.negativeSignalCount,
    neutralSignalCount: entry.neutralSignalCount,
    privacyBoundaries: new Set(entry.privacyBoundaries),
    protocols: new Set(entry.protocols),
    sourceVisibilities: new Set(entry.sourceVisibilities),
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt
  };
}

function createEmptyState(updatedAt: string): MutableProfileState {
  return {
    updatedAt,
    signalCount: 0,
    entries: new Map<string, MutableProfileEntry>()
  };
}

function freezeSortedSet<T extends string>(values: ReadonlySet<T>): readonly T[] {
  return Object.freeze([...values].sort());
}

function createEmptySnapshot(updatedAt: string): RecommendationProfileSnapshot {
  return Object.freeze({
    schemaVersion: RECOMMENDATION_PROFILE_SCHEMA_VERSION,
    updatedAt,
    signalCount: 0,
    entries: Object.freeze([])
  });
}

function pruneExpiredEntries(state: MutableProfileState, now: NormalizedTimestamp): void {
  let removedSignalCount = 0;

  for (const [key, entry] of state.entries.entries()) {
    if (isExpiredTimestamp(entry.expiresAt, now.millis)) {
      removedSignalCount += entry.signalCount;
      state.entries.delete(key);
    }
  }

  if (removedSignalCount > 0) {
    state.signalCount = Math.max(0, state.signalCount - removedSignalCount);
    state.updatedAt = maxTimestampWithRightMillis(state.updatedAt, now.value, now.millis);
  }
}

function cloneEntry(entry: MutableProfileEntry): RecommendationProfileEntry {
  const snapshot: RecommendationProfileEntry = {
    target: cloneTarget(entry.target),
    score: entry.score,
    confidence: entry.confidence,
    signalCount: entry.signalCount,
    positiveSignalCount: entry.positiveSignalCount,
    negativeSignalCount: entry.negativeSignalCount,
    neutralSignalCount: entry.neutralSignalCount,
    privacyBoundaries: freezeSortedSet(entry.privacyBoundaries),
    protocols: freezeSortedSet(entry.protocols),
    sourceVisibilities: freezeSortedSet(entry.sourceVisibilities),
    updatedAt: entry.updatedAt
  };

  if (entry.expiresAt !== undefined) {
    snapshot.expiresAt = entry.expiresAt;
  }

  return Object.freeze(snapshot);
}

function createSnapshotFromSortedEntries(
  state: MutableProfileState,
  sortedEntries: readonly MutableProfileEntry[]
): RecommendationProfileSnapshot {
  return Object.freeze({
    schemaVersion: RECOMMENDATION_PROFILE_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    signalCount: state.signalCount,
    entries: Object.freeze(sortedEntries.map(cloneEntry))
  });
}

function createSnapshot(state: MutableProfileState | undefined, now: NormalizedTimestamp): RecommendationProfileSnapshot {
  if (state === undefined) {
    return createEmptySnapshot(now.value);
  }

  pruneExpiredEntries(state, now);
  return createSnapshotFromSortedEntries(
    state,
    sortEntryRecords(state.entries).map(([, entry]) => entry)
  );
}

function createMutableEntry(prepared: PreparedInterestSignal, now: NormalizedTimestamp): MutableProfileEntry {
  const signal = prepared.signal;
  const delta = signalDelta(signal.polarity, signal.strength, signal.confidence);
  return {
    target: signal.target,
    score: clampUnitScore(delta),
    confidence: signal.confidence,
    signalCount: 1,
    positiveSignalCount: signal.polarity === "positive" ? 1 : 0,
    negativeSignalCount: signal.polarity === "negative" ? 1 : 0,
    neutralSignalCount: signal.polarity === "neutral" ? 1 : 0,
    privacyBoundaries: new Set([signal.privacyBoundary]),
    protocols: new Set([signal.evidence.protocol]),
    sourceVisibilities: new Set([signal.evidence.sourceVisibility]),
    updatedAt: now.millis >= prepared.observedAtMillis ? now.value : signal.evidence.observedAt,
    expiresAt: signal.expiresAt
  };
}

function updateEntryExpiration(entry: MutableProfileEntry, prepared: PreparedInterestSignal): void {
  entry.expiresAt = latestExpiration(entry.expiresAt, prepared.signal.expiresAt, prepared.expiresAtMillis);
}

function applySignalToEntry(entry: MutableProfileEntry, prepared: PreparedInterestSignal, now: NormalizedTimestamp): void {
  const signal = prepared.signal;
  const updatedAt = now.millis >= prepared.observedAtMillis ? now.value : signal.evidence.observedAt;
  const updatedAtMillis = Math.max(now.millis, prepared.observedAtMillis);

  entry.score = clampUnitScore(entry.score + signalDelta(signal.polarity, signal.strength, signal.confidence));
  entry.confidence = Math.max(entry.confidence, signal.confidence);
  entry.signalCount += 1;
  entry.positiveSignalCount += signal.polarity === "positive" ? 1 : 0;
  entry.negativeSignalCount += signal.polarity === "negative" ? 1 : 0;
  entry.neutralSignalCount += signal.polarity === "neutral" ? 1 : 0;
  entry.privacyBoundaries.add(signal.privacyBoundary);
  entry.protocols.add(signal.evidence.protocol);
  entry.sourceVisibilities.add(signal.evidence.sourceVisibility);
  entry.updatedAt = maxTimestampWithRightMillis(entry.updatedAt, updatedAt, updatedAtMillis);
  updateEntryExpiration(entry, prepared);
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_ENTRIES;
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_ENTRIES_UPPER_BOUND) {
    throw new TypeError("Invalid recommendation profile max entries.");
  }

  return value;
}

function normalizeAllowedPrivacyBoundaries(
  values: readonly RecommendationInterestPrivacyBoundary[] | undefined
): ReadonlySet<RecommendationInterestPrivacyBoundary> {
  const boundaries = values ?? ["local_only"];

  if (boundaries.length === 0 || boundaries.some((boundary) => !PRIVACY_BOUNDARY_SET.has(boundary))) {
    throw new TypeError("Invalid recommendation profile privacy boundary configuration.");
  }

  return new Set(boundaries);
}

function prepareSignalBatch(
  rawSignals: readonly RecommendationInterestSignal[],
  allowedPrivacyBoundaries: ReadonlySet<RecommendationInterestPrivacyBoundary>,
  now: NormalizedTimestamp
): PreparedSignalBatch {
  const acceptedSignals: PreparedInterestSignal[] = [];
  let skippedExpiredSignalCount = 0;

  for (const rawSignal of rawSignals) {
    if (!isRecommendationInterestSignal(rawSignal)) {
      throw new TypeError("Invalid recommendation profile interest signal.");
    }

    const signal = normalizeRecommendationInterestSignal(rawSignal);
    if (!allowedPrivacyBoundaries.has(signal.privacyBoundary)) {
      throw new TypeError("Recommendation profile signal privacy boundary is not allowed.");
    }

    const observedAtMillis = timestampMillis(signal.evidence.observedAt);
    const expiresAtMillis = signal.expiresAt === undefined ? undefined : timestampMillis(signal.expiresAt);
    if (expiresAtMillis !== undefined && expiresAtMillis <= now.millis) {
      skippedExpiredSignalCount += 1;
      continue;
    }

    acceptedSignals.push({
      signal,
      key: targetKey(signal.target),
      observedAtMillis,
      expiresAtMillis
    });
  }

  return { acceptedSignals, skippedExpiredSignalCount };
}

function trimSortedEntries(
  state: MutableProfileState,
  sortedRecords: readonly [string, MutableProfileEntry][],
  maxEntries: number
): MutableProfileEntry[] {
  if (sortedRecords.length <= maxEntries) {
    return sortedRecords.map(([, entry]) => entry);
  }

  const keptEntries = sortedRecords.slice(0, maxEntries).map(([, entry]) => entry);
  for (const [key, entry] of sortedRecords.slice(maxEntries)) {
    state.signalCount = Math.max(0, state.signalCount - entry.signalCount);
    state.entries.delete(key);
  }

  return keptEntries;
}

export function createInMemoryRecommendationProfileStore(
  options: InMemoryRecommendationProfileStoreOptions = {}
): RecommendationProfileStore {
  const profiles = new Map<string, MutableProfileState>();
  const nowProvider = options.now ?? (() => new Date().toISOString());
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  const allowedPrivacyBoundaries = normalizeAllowedPrivacyBoundaries(options.allowedPrivacyBoundaries);

  return {
    async ingestSignals(input) {
      if (!isObject(input) || !isNonEmptyString(input.subjectId) || !Array.isArray(input.signals)) {
        throw new TypeError("Invalid recommendation profile signal ingest input.");
      }

      assertValidSubjectId(input.subjectId);
      const now = normalizeNow(input.now, nowProvider);
      const { acceptedSignals, skippedExpiredSignalCount } = prepareSignalBatch(
        input.signals,
        allowedPrivacyBoundaries,
        now
      );
      const existingState = profiles.get(input.subjectId);
      const state: MutableProfileState = existingState === undefined
        ? createEmptyState(now.value)
        : {
            updatedAt: existingState.updatedAt,
            signalCount: existingState.signalCount,
            entries: new Map(existingState.entries)
          };
      const clonedEntryKeys = new Set<string>();

      for (const prepared of acceptedSignals) {
        const existing = state.entries.get(prepared.key);
        if (existing === undefined) {
          state.entries.set(prepared.key, createMutableEntry(prepared, now));
          clonedEntryKeys.add(prepared.key);
        } else {
          const entry = clonedEntryKeys.has(prepared.key) ? existing : cloneMutableEntry(existing);
          if (!clonedEntryKeys.has(prepared.key)) {
            state.entries.set(prepared.key, entry);
            clonedEntryKeys.add(prepared.key);
          }
          applySignalToEntry(entry, prepared, now);
        }

        state.signalCount += 1;
        state.updatedAt = maxTimestampWithRightMillis(state.updatedAt, now.value, now.millis);
      }

      pruneExpiredEntries(state, now);
      const sortedEntries = trimSortedEntries(state, sortEntryRecords(state.entries), maxEntries);
      const profile = createSnapshotFromSortedEntries(state, sortedEntries);
      profiles.set(input.subjectId, state);

      return Object.freeze({
        acceptedSignalCount: acceptedSignals.length,
        skippedExpiredSignalCount,
        profile
      });
    },

    async readProfile(subjectId) {
      assertValidSubjectId(subjectId);
      return createSnapshot(profiles.get(subjectId), normalizeNow(undefined, nowProvider));
    },

    async deleteProfile(intent) {
      if (
        intent === null ||
        typeof intent !== "object" ||
        !isNonEmptyString(intent.subjectId) ||
        intent.scope !== "recommendation_derived_data" ||
        !Array.isArray(intent.targets) ||
        !intent.targets.includes("profile")
      ) {
        throw new TypeError("Invalid recommendation profile deletion intent.");
      }

      assertValidSubjectId(intent.subjectId);
      const now = normalizeNow(intent.requestedAt, nowProvider);
      profiles.delete(intent.subjectId);
      return createEmptySnapshot(now.value);
    }
  };
}
