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
// Matches v2 and up only, with no leading zeros. v0, v01 and v1 are not "newer", so they get the generic error.
const NEWER_RECORD_SCHEMA_PATTERN = /^recommendation-candidate-event-record\.v(?:[2-9]|[1-9]\d+)$/u;

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
  /**
   * Set to true when `save` honors `expectedDigest` (see below). Without it the store is treated as
   * single-writer: two devices saving at once can lose each other's events, and nothing here detects that.
   */
  supportsCompareAndSet?: boolean;
  load(subjectId: string): Promise<unknown>;
  /**
   * With `expectedDigest` set, a store that supports compare-and-set must save only if the record it
   * holds right now has exactly that digest (`null` means it must hold no record), and otherwise throw
   * `RecommendationCandidateEventConflictError` without writing. The lifecycle then reloads, merges and tries again.
   */
  save(subjectId: string, record: RecommendationCandidateEventRecord, options?: { expectedDigest: string | null }): Promise<void>;
  delete(subjectId: string): Promise<void>;
}

/** Thrown by a compare-and-set store when the record changed since it was read. The lifecycle retries on it. */
export class RecommendationCandidateEventConflictError extends Error {
  constructor() {
    super("Recommendation candidate event record changed since it was read.");
    this.name = "RecommendationCandidateEventConflictError";
  }
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
  // A record written by a newer version of this format is refused with a message that says so, rather
  // than as a generic parse failure. It is never read on a guess: dropping it would make plans look usable.
  if (
    typeof record.schemaVersion === "string" && NEWER_RECORD_SCHEMA_PATTERN.test(record.schemaVersion)
  ) {
    throw new TypeError("Unsupported recommendation candidate event record schema version. Upgrade this library to read it.");
  }
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

const SET_LEVEL_KINDS: ReadonlySet<string> = new Set(["set_deleted", "set_not_discoverable", "set_sensitive"]);

/**
 * What identifies "the same fact" for a set-level event. Reporting the same set again with a later
 * time is the same fact seen again, so it must not take a second slot. A different candidate ID is a
 * different fact, because that candidate is excluded everywhere, not only inside the set.
 */
function slotKey(event: RecommendationCandidateLifecycleEvent): string {
  return SET_LEVEL_KINDS.has(event.kind)
    ? JSON.stringify([event.kind, event.setSourceId, event.candidateId ?? null])
    : eventKey(event);
}

/** True when `candidate` should replace `held` for the same slot. Later report time wins, ties go to the larger key so the result never depends on arrival order. */
function supersedes(candidate: RecommendationCandidateLifecycleEvent, held: RecommendationCandidateLifecycleEvent): boolean {
  if (candidate.occurredAt !== held.occurredAt) return Date.parse(candidate.occurredAt) > Date.parse(held.occurredAt);
  return eventKey(candidate) > eventKey(held);
}

/** One event per slot, keeping the winner. Order of the input does not change the result. */
function coalesceEvents(events: readonly RecommendationCandidateLifecycleEvent[]): RecommendationCandidateLifecycleEvent[] {
  const bySlot = new Map<string, RecommendationCandidateLifecycleEvent>();
  for (const event of events) {
    const key = slotKey(event);
    const held = bySlot.get(key);
    if (held === undefined || supersedes(event, held)) bySlot.set(key, event);
  }
  return [...bySlot.values()];
}

/**
 * The incoming events that would change what is held. Repeats inside the batch are removed, and so are
 * set-level events the store already covers with the same or a later report.
 */
export function selectNewRecommendationCandidateEvents(
  current: readonly RecommendationStoredCandidateEvent[],
  incoming: readonly RecommendationCandidateLifecycleEvent[]
): readonly RecommendationCandidateLifecycleEvent[] {
  const heldBySlot = new Map(current.map((entry) => [slotKey(entry.event), entry.event] as const));
  const fresh: RecommendationCandidateLifecycleEvent[] = [];
  for (const event of coalesceEvents(incoming)) {
    const held = heldBySlot.get(slotKey(event));
    if (held !== undefined && !supersedes(event, held)) continue;
    fresh.push(event);
  }
  return fresh;
}

/** Digest of a raw loaded record, or null when there is none. Used as the compare-and-set token. */
export function recommendationCandidateEventRecordDigest(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.digest === "string" ? raw.digest : null;
}

/**
 * Merges new events into the live ones. Events already held keep their first recording time, so
 * replaying a report changes nothing. A set-level event for a set that already has one of the same
 * kind replaces it only when it is later, so a set uses at most one slot per kind. Past the cap the oldest entries that are not set-level events
 * are compacted away. Set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`) are
 * never evicted to make room, because losing one makes the set eligible again, and an event being
 * added now is never dropped to make room either. If the cap would force either out, this throws and
 * nothing is changed; set-level events leave only when they expire.
 */
export function mergeRecommendationCandidateEventEntries(
  current: readonly RecommendationStoredCandidateEvent[],
  incoming: readonly RecommendationCandidateLifecycleEvent[],
  limits: RecommendationCandidateEventStoreLimits,
  now: string
): { entries: readonly RecommendationStoredCandidateEvent[]; changed: boolean } {
  const byKey = new Map<string, RecommendationStoredCandidateEvent>();
  let changed = false;
  for (const entry of current) {
    // A record written before coalescing may hold several entries for one slot. Keep the winner.
    const key = slotKey(entry.event);
    const held = byKey.get(key);
    if (held === undefined) byKey.set(key, entry);
    else {
      changed = true;
      if (supersedes(entry.event, held.event)) byKey.set(key, entry);
    }
  }
  const added = new Set<RecommendationStoredCandidateEvent>();
  for (const event of coalesceEvents(incoming)) {
    const key = slotKey(event);
    const held = byKey.get(key);
    if (held === undefined || supersedes(event, held.event)) {
      const entry = Object.freeze({ recordedAt: now, event });
      byKey.set(key, entry);
      added.add(entry);
      changed = true;
    }
  }
  const sorted = [...byKey.values()].sort(compareEntries);
  let kept = sorted;
  if (sorted.length > limits.maxEvents) {
    let excess = sorted.length - limits.maxEvents;
    const evict = new Set<RecommendationStoredCandidateEvent>();
    for (const entry of sorted) {
      if (excess === 0) break;
      if (SET_LEVEL_KINDS.has(entry.event.kind) || added.has(entry)) continue;
      evict.add(entry);
      excess -= 1;
    }
    if (excess > 0) throw new TypeError("Recommendation candidate event store has no room that does not evict a set-level or new event.");
    kept = sorted.filter((entry) => !evict.has(entry));
  }
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
  adapterId: "in-memory-candidate-events-ephemeral",
  domains: Object.freeze([RECOMMENDATION_CANDIDATE_EVENT_STATE_DOMAIN]),
  authority: "device_owned",
  processingBoundary: "local_only",
  persistence: "ephemeral",
  requiresNetwork: false,
  supportsOffline: true,
  userExportable: true,
  userDeletable: true,
  encryptedAtRest: false
}) as RecommendationStateStorageAdapterManifest;

/**
 * A reference store that keeps one JSON copy per subject in process memory. It is ephemeral: a restart
 * loses everything, and its default manifest says so. It supports compare-and-set. Records are copied
 * in and out, so callers cannot edit them in place. Pass a manifest to describe a store you build on it.
 */
export function createInMemoryRecommendationCandidateEventStore(
  manifest: RecommendationStateStorageAdapterManifest = DEVICE_MANIFEST
): RecommendationCandidateEventStore {
  const records = new Map<string, string>();
  return Object.freeze({
    manifest,
    supportsCompareAndSet: true,
    async load(subjectId: string) {
      assertValidRecommendationProfileSubjectId(subjectId);
      const text = records.get(subjectId);
      return text === undefined ? undefined : JSON.parse(text) as unknown;
    },
    async save(subjectId: string, record: RecommendationCandidateEventRecord, options?: { expectedDigest: string | null }) {
      assertValidRecommendationProfileSubjectId(subjectId);
      if (options !== undefined) {
        const held = records.get(subjectId);
        const heldDigest = held === undefined ? null : recommendationCandidateEventRecordDigest(JSON.parse(held) as unknown);
        if (heldDigest !== options.expectedDigest) throw new RecommendationCandidateEventConflictError();
      }
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
