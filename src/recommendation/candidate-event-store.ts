import { sha256Hex } from "../runtime/hash.js";
import {
  MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS,
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidateLifecycleEvent
} from "./candidate-lifecycle.js";
import type { RecommendationDerivedStateInvalidator } from "./derived-state-invalidation-orchestrator.js";
import { assertRecommendationStateStorageManifest, evaluateRecommendationStatePlacement, type RecommendationStateStorageAdapterManifest } from "./state-placement-policy.js";
import { assertValidRecommendationProfileSubjectId } from "./profile-store-persistence-key.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION = "recommendation-candidate-event-record.v1" as const;

/** Placement domain the event record is checked against. */
export const RECOMMENDATION_CANDIDATE_EVENT_STATE_DOMAIN = "candidate_lifecycle_events" as const;

export const DEFAULT_RECOMMENDATION_CANDIDATE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_RECOMMENDATION_CANDIDATE_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_RETENTION_MS = 60 * 1000;

export interface RecommendationStoredCandidateEvent {
  /** When this lifecycle first accepted the event. Retention and compaction use this, not the reporter's time. */
  recordedAt: string;
  event: RecommendationCandidateLifecycleEvent;
}

/** What a store holds for one subject. The digest detects damage and swaps; it is not a signature. */
export interface RecommendationCandidateEventRecord {
  schemaVersion: typeof RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION;
  subjectId: string;
  updatedAt: string;
  entries: readonly RecommendationStoredCandidateEvent[];
  digest: string;
}

/**
 * A durable home for one subject's reported candidate events. The store has to be device-owned or
 * user-owned; provider-owned placement is refused when it is attached to a lifecycle. Reads may return
 * anything, because the lifecycle validates them and rejects a record that does not check out.
 */
export interface RecommendationCandidateEventStore {
  manifest: RecommendationStateStorageAdapterManifest;
  load(subjectId: string): Promise<unknown>;
  save(subjectId: string, record: RecommendationCandidateEventRecord): Promise<void>;
  delete(subjectId: string): Promise<void>;
}

export interface RecommendationCandidateEventStoreLimits {
  retentionMs: number;
  maxEvents: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function eventKey(event: RecommendationCandidateLifecycleEvent): string {
  return JSON.stringify(event, Object.keys(event).sort());
}

function compareEntries(left: RecommendationStoredCandidateEvent, right: RecommendationStoredCandidateEvent): number {
  if (left.recordedAt !== right.recordedAt) return left.recordedAt < right.recordedAt ? -1 : 1;
  const leftKey = eventKey(left.event);
  const rightKey = eventKey(right.event);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function digestOf(subjectId: string, updatedAt: string, entries: readonly RecommendationStoredCandidateEvent[]): string {
  return sha256Hex(JSON.stringify([RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION, subjectId, updatedAt, entries.map((entry) => [entry.recordedAt, eventKey(entry.event)])]));
}

export function normalizeRecommendationCandidateEventStoreLimits(
  input: { retentionMs?: number; maxEvents?: number } | undefined
): RecommendationCandidateEventStoreLimits {
  const retentionMs = input?.retentionMs ?? DEFAULT_RECOMMENDATION_CANDIDATE_EVENT_RETENTION_MS;
  const maxEvents = input?.maxEvents ?? MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < MIN_RETENTION_MS || retentionMs > MAX_RECOMMENDATION_CANDIDATE_EVENT_RETENTION_MS) {
    throw new TypeError("Invalid recommendation candidate event retention.");
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS) {
    throw new TypeError("Invalid recommendation candidate event limit.");
  }
  return Object.freeze({ retentionMs, maxEvents });
}

/** Checks the store can hold subject-level events: placement policy allows it and the methods exist. */
export function assertRecommendationCandidateEventStore(store: unknown): asserts store is RecommendationCandidateEventStore {
  if (
    !isRecord(store) || !isRecord(store.manifest) || typeof store.load !== "function" ||
    typeof store.save !== "function" || typeof store.delete !== "function"
  ) {
    throw new TypeError("Invalid recommendation candidate event store.");
  }
  const manifest = assertRecommendationStateStorageManifest(store.manifest as unknown as RecommendationStateStorageAdapterManifest);
  const evaluation = evaluateRecommendationStatePlacement(manifest, RECOMMENDATION_CANDIDATE_EVENT_STATE_DOMAIN);
  if (evaluation.decision !== "allow") {
    throw new TypeError("Recommendation candidate event store violates placement policy.");
  }
}

/**
 * Validates a loaded record for one subject. A record that names another subject, carries unknown
 * fields, holds an event that does not validate, is out of order, or fails its digest is rejected
 * outright. Dropping it quietly would make a plan look usable again.
 */
export function readRecommendationCandidateEventRecord(
  raw: unknown,
  subjectId: string,
  limits: RecommendationCandidateEventStoreLimits,
  now: string
): readonly RecommendationStoredCandidateEvent[] {
  const bad = (): never => { throw new TypeError("Invalid stored recommendation candidate event record."); };
  if (raw === undefined) return Object.freeze([]);
  if (!isRecord(raw)) return bad();
  const record: Record<string, unknown> = raw;
  if (
    Object.keys(record).sort().join(",") !== "digest,entries,schemaVersion,subjectId,updatedAt" ||
    record.schemaVersion !== RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION || record.subjectId !== subjectId ||
    typeof record.digest !== "string" || typeof record.updatedAt !== "string" || !Array.isArray(record.entries) ||
    record.entries.length > MAX_RECOMMENDATION_CANDIDATE_LIFECYCLE_EVENTS
  ) return bad();
  const updatedAt = normalizeStrictRfc3339Timestamp(record.updatedAt, "Invalid stored recommendation candidate event record.");
  const entries: RecommendationStoredCandidateEvent[] = [];
  for (const item of record.entries as unknown[]) {
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== "event,recordedAt") return bad();
    const recordedAt = normalizeStrictRfc3339Timestamp(item.recordedAt, "Invalid stored recommendation candidate event record.");
    const [event, ...rest] = normalizeRecommendationCandidateLifecycleEvents([item.event], { now: recordedAt });
    if (event === undefined || rest.length > 0) return bad();
    entries.push(Object.freeze({ recordedAt, event }));
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareEntries(entries[index - 1]!, entries[index]!) >= 0) return bad();
  }
  if (record.digest !== digestOf(subjectId, updatedAt, entries)) return bad();
  // Expired events are dropped on read, so an old record can never keep a plan unusable forever.
  const cutoff = Date.parse(now) - limits.retentionMs;
  return Object.freeze(entries.filter((entry) => Date.parse(entry.recordedAt) > cutoff));
}

/**
 * Merges new events into the live ones. Events already held keep their first recording time, so
 * replaying a report changes nothing. Past the cap the oldest entries are compacted away.
 */
export function mergeRecommendationCandidateEventEntries(
  current: readonly RecommendationStoredCandidateEvent[],
  incoming: readonly RecommendationCandidateLifecycleEvent[],
  limits: RecommendationCandidateEventStoreLimits,
  now: string
): { entries: readonly RecommendationStoredCandidateEvent[]; changed: boolean } {
  const byKey = new Map(current.map((entry) => [eventKey(entry.event), entry] as const));
  let changed = false;
  for (const event of incoming) {
    const key = eventKey(event);
    if (!byKey.has(key)) {
      byKey.set(key, Object.freeze({ recordedAt: now, event }));
      changed = true;
    }
  }
  const sorted = [...byKey.values()].sort(compareEntries);
  const kept = sorted.length > limits.maxEvents ? sorted.slice(sorted.length - limits.maxEvents) : sorted;
  return { entries: Object.freeze(kept), changed: changed || kept.length !== sorted.length };
}

export function buildRecommendationCandidateEventRecord(
  subjectId: string,
  entries: readonly RecommendationStoredCandidateEvent[],
  updatedAt: string
): RecommendationCandidateEventRecord {
  return Object.freeze({
    schemaVersion: RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION,
    subjectId,
    updatedAt,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ recordedAt: entry.recordedAt, event: { ...entry.event } }))),
    digest: digestOf(subjectId, updatedAt, entries)
  });
}

const DEVICE_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  adapterId: "in-memory-candidate-events",
  domains: Object.freeze([RECOMMENDATION_CANDIDATE_EVENT_STATE_DOMAIN]),
  authority: "device_owned",
  processingBoundary: "local_only",
  persistence: "persistent",
  requiresNetwork: false,
  supportsOffline: true,
  userExportable: true,
  userDeletable: true,
  encryptedAtRest: false
}) as RecommendationStateStorageAdapterManifest;

/** A reference store that keeps one JSON copy per subject. Records are copied in and out, so callers cannot edit them in place. */
export function createInMemoryRecommendationCandidateEventStore(
  manifest: RecommendationStateStorageAdapterManifest = DEVICE_MANIFEST
): RecommendationCandidateEventStore {
  const records = new Map<string, string>();
  return Object.freeze({
    manifest,
    async load(subjectId: string) {
      assertValidRecommendationProfileSubjectId(subjectId);
      const text = records.get(subjectId);
      return text === undefined ? undefined : JSON.parse(text) as unknown;
    },
    async save(subjectId: string, record: RecommendationCandidateEventRecord) {
      assertValidRecommendationProfileSubjectId(subjectId);
      records.set(subjectId, JSON.stringify(record));
    },
    async delete(subjectId: string) {
      assertValidRecommendationProfileSubjectId(subjectId);
      records.delete(subjectId);
    }
  });
}

/**
 * Wraps an invalidator so a deletion request also clears the subject's stored candidate events. Attach
 * it to one derived-state target (the candidate cache is the natural one). The orchestrator already
 * keeps a durable deletion task and retries a failed target, so a crash mid-delete finishes on
 * recovery. Other invalidation reasons pass straight through, because a profile change does not
 * make a reported candidate fact any less true.
 */
export function createRecommendationCandidateEventDeletionInvalidator(
  store: RecommendationCandidateEventStore,
  inner?: RecommendationDerivedStateInvalidator
): RecommendationDerivedStateInvalidator {
  assertRecommendationCandidateEventStore(store);
  return Object.freeze({
    async invalidate(request: Parameters<RecommendationDerivedStateInvalidator["invalidate"]>[0]) {
      if (request.reason === "deletion_requested") await store.delete(request.subjectId);
      if (inner !== undefined) await inner.invalidate(request);
    }
  });
}
