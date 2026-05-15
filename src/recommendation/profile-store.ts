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
  expiresAt?: string;
}

interface MutableProfileState {
  updatedAt: string;
  signalCount: number;
  entries: Map<string, MutableProfileEntry>;
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

function assertValidTimestamp(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("Invalid recommendation profile timestamp.");
  }
}

function normalizeNow(value: string | undefined, fallback: () => string): string {
  const timestamp = value ?? fallback();
  assertValidTimestamp(timestamp);
  return timestamp;
}

function timestampMillis(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("Invalid recommendation profile timestamp.");
  }

  return parsed;
}

function maxTimestamp(left: string, right: string): string {
  return timestampMillis(left) >= timestampMillis(right) ? left : right;
}

function earliestTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  return timestampMillis(left) <= timestampMillis(right) ? left : right;
}

function isExpiredTimestamp(expiresAt: string | undefined, now: string): boolean {
  if (expiresAt === undefined) {
    return false;
  }

  assertValidTimestamp(expiresAt);
  return timestampMillis(expiresAt) <= timestampMillis(now);
}

function isExpired(signal: RecommendationInterestSignal, now: string): boolean {
  return isExpiredTimestamp(signal.expiresAt, now);
}

function clampUnitScore(value: number): number {
  if (!Number.isFinite(value)) {
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

function cloneTarget(target: RecommendationInterestTarget): RecommendationInterestTarget {
  return Object.freeze({ kind: target.kind, key: target.key });
}

function cloneMutableEntry(entry: MutableProfileEntry): MutableProfileEntry {
  const cloned: MutableProfileEntry = {
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
    updatedAt: entry.updatedAt
  };

  if (entry.expiresAt !== undefined) {
    cloned.expiresAt = entry.expiresAt;
  }

  return cloned;
}

function cloneMutableState(state: MutableProfileState): MutableProfileState {
  return {
    updatedAt: state.updatedAt,
    signalCount: state.signalCount,
    entries: new Map([...state.entries.entries()].map(([key, entry]) => [key, cloneMutableEntry(entry)]))
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

function pruneExpiredEntries(state: MutableProfileState, now: string): void {
  let removedSignalCount = 0;

  for (const [key, entry] of state.entries.entries()) {
    if (isExpiredTimestamp(entry.expiresAt, now)) {
      removedSignalCount += entry.signalCount;
      state.entries.delete(key);
    }
  }

  if (removedSignalCount > 0) {
    state.signalCount = Math.max(0, state.signalCount - removedSignalCount);
    state.updatedAt = maxTimestamp(state.updatedAt, now);
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

function createSnapshot(state: MutableProfileState | undefined, now: string): RecommendationProfileSnapshot {
  if (state === undefined) {
    return createEmptySnapshot(now);
  }

  pruneExpiredEntries(state, now);
  const entries = [...state.entries.values()]
    .map(cloneEntry)
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score) || left.target.key.localeCompare(right.target.key));

  return Object.freeze({
    schemaVersion: RECOMMENDATION_PROFILE_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    signalCount: state.signalCount,
    entries: Object.freeze(entries)
  });
}

function createMutableEntry(signal: RecommendationInterestSignal, now: string): MutableProfileEntry {
  const delta = signalDelta(signal.polarity, signal.strength, signal.confidence);
  const observedAt = signal.evidence.observedAt;
  assertValidTimestamp(observedAt);
  const entry: MutableProfileEntry = {
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
    updatedAt: maxTimestamp(now, observedAt)
  };

  if (signal.expiresAt !== undefined) {
    entry.expiresAt = signal.expiresAt;
  }

  return entry;
}

function updateEntryExpiration(entry: MutableProfileEntry, signal: RecommendationInterestSignal): void {
  const expiresAt = earliestTimestamp(entry.expiresAt, signal.expiresAt);
  if (expiresAt === undefined) {
    delete entry.expiresAt;
    return;
  }

  entry.expiresAt = expiresAt;
}

function applySignalToEntry(entry: MutableProfileEntry, signal: RecommendationInterestSignal, now: string): void {
  const observedAt = signal.evidence.observedAt;
  assertValidTimestamp(observedAt);

  entry.score = clampUnitScore(entry.score + signalDelta(signal.polarity, signal.strength, signal.confidence));
  entry.confidence = Math.max(entry.confidence, signal.confidence);
  entry.signalCount += 1;
  entry.positiveSignalCount += signal.polarity === "positive" ? 1 : 0;
  entry.negativeSignalCount += signal.polarity === "negative" ? 1 : 0;
  entry.neutralSignalCount += signal.polarity === "neutral" ? 1 : 0;
  entry.privacyBoundaries.add(signal.privacyBoundary);
  entry.protocols.add(signal.evidence.protocol);
  entry.sourceVisibilities.add(signal.evidence.sourceVisibility);
  entry.updatedAt = maxTimestamp(entry.updatedAt, maxTimestamp(now, observedAt));
  updateEntryExpiration(entry, signal);
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

function trimEntries(state: MutableProfileState, maxEntries: number): void {
  if (state.entries.size <= maxEntries) {
    return;
  }

  const keep = new Set(
    [...state.entries.entries()]
      .sort((left, right) => Math.abs(right[1].score) - Math.abs(left[1].score) || left[0].localeCompare(right[0]))
      .slice(0, maxEntries)
      .map(([key]) => key)
  );

  for (const key of state.entries.keys()) {
    if (!keep.has(key)) {
      state.entries.delete(key);
    }
  }
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
      const existingState = profiles.get(input.subjectId);
      const state = existingState === undefined ? createEmptyState(now) : cloneMutableState(existingState);
      let acceptedSignalCount = 0;
      let skippedExpiredSignalCount = 0;

      for (const rawSignal of input.signals) {
        if (!isRecommendationInterestSignal(rawSignal)) {
          throw new TypeError("Invalid recommendation profile interest signal.");
        }

        const signal = normalizeRecommendationInterestSignal(rawSignal);
        if (!allowedPrivacyBoundaries.has(signal.privacyBoundary)) {
          throw new TypeError("Recommendation profile signal privacy boundary is not allowed.");
        }

        if (isExpired(signal, now)) {
          skippedExpiredSignalCount += 1;
          continue;
        }

        const key = targetKey(signal.target);
        const existing = state.entries.get(key);
        if (existing === undefined) {
          state.entries.set(key, createMutableEntry(signal, now));
        } else {
          applySignalToEntry(existing, signal, now);
        }

        acceptedSignalCount += 1;
        state.signalCount += 1;
        state.updatedAt = maxTimestamp(state.updatedAt, now);
      }

      trimEntries(state, maxEntries);
      const profile = createSnapshot(state, now);
      profiles.set(input.subjectId, state);

      return Object.freeze({
        acceptedSignalCount,
        skippedExpiredSignalCount,
        profile
      });
    },

    async readProfile(subjectId) {
      assertValidSubjectId(subjectId);
      const now = normalizeNow(undefined, nowProvider);
      return createSnapshot(profiles.get(subjectId), now);
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
      return createEmptySnapshot(now);
    }
  };
}
