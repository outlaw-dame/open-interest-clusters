import { sha256Hex } from "../runtime/hash.js";
import {
  normalizeRecommendationInterestSignal,
  type RecommendationInterestSignal
} from "./interest-signal.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export const RECOMMENDATION_SIGNAL_LEDGER_OPERATIONS = ["apply", "retract"] as const;
export type RecommendationSignalLedgerOperation = typeof RECOMMENDATION_SIGNAL_LEDGER_OPERATIONS[number];

export const RECOMMENDATION_SIGNAL_RETRACTION_REASONS = [
  "source_deleted",
  "source_retracted",
  "label_negated",
  "expired",
  "consent_revoked",
  "corrected"
] as const;
export type RecommendationSignalRetractionReason = typeof RECOMMENDATION_SIGNAL_RETRACTION_REASONS[number];

export interface RecommendationSignalLedgerApplyEventInput {
  operation: "apply";
  operationId: string;
  sourceEventId: string;
  occurredAt: string;
  signal: RecommendationInterestSignal;
}

export interface RecommendationSignalLedgerRetractEventInput {
  operation: "retract";
  operationId: string;
  sourceEventId: string;
  retractsSourceEventId: string;
  occurredAt: string;
  reason: RecommendationSignalRetractionReason;
}

export type RecommendationSignalLedgerEventInput =
  | RecommendationSignalLedgerApplyEventInput
  | RecommendationSignalLedgerRetractEventInput;

export interface RecommendationSignalLedgerOptions {
  namespace?: string;
  salt?: string;
  maxOperations?: number;
}

export type RecommendationSignalLedgerDecision =
  | "applied"
  | "retracted"
  | "duplicate"
  | "suppressed_by_retraction";

export interface RecommendationSignalLedgerIngestResult {
  decision: RecommendationSignalLedgerDecision;
  operationKey: string;
  sourceEventKey: string;
  activeSignalCount: number;
  tombstoneCount: number;
}

export interface RecommendationSignalLedgerBatchResult {
  results: readonly RecommendationSignalLedgerIngestResult[];
  appliedCount: number;
  retractedCount: number;
  duplicateCount: number;
  suppressedCount: number;
  activeSignalCount: number;
  tombstoneCount: number;
}

export interface RecommendationSignalLedgerActiveEntry {
  sourceEventKey: string;
  operationKey: string;
  occurredAt: string;
  signal: RecommendationInterestSignal;
}

export interface RecommendationSignalLedgerTombstone {
  sourceEventKey: string;
  operationKey: string;
  occurredAt: string;
  reason: RecommendationSignalRetractionReason;
}

export interface RecommendationSignalLedgerSnapshot {
  activeSignals: readonly RecommendationSignalLedgerActiveEntry[];
  tombstones: readonly RecommendationSignalLedgerTombstone[];
  operationCount: number;
}

export interface RecommendationSignalLedger {
  ingest(event: RecommendationSignalLedgerEventInput): RecommendationSignalLedgerIngestResult;
  ingestBatch(events: readonly RecommendationSignalLedgerEventInput[]): RecommendationSignalLedgerBatchResult;
  listActiveSignals(options?: { now?: string }): readonly RecommendationSignalLedgerActiveEntry[];
  snapshot(options?: { now?: string }): RecommendationSignalLedgerSnapshot;
  clear(): void;
}

interface NormalizedApplyEvent {
  operation: "apply";
  operationId: string;
  sourceEventId: string;
  occurredAt: string;
  occurredAtMillis: number;
  signal: RecommendationInterestSignal;
}

interface NormalizedRetractEvent {
  operation: "retract";
  operationId: string;
  sourceEventId: string;
  retractsSourceEventId: string;
  occurredAt: string;
  occurredAtMillis: number;
  reason: RecommendationSignalRetractionReason;
}

type NormalizedEvent = NormalizedApplyEvent | NormalizedRetractEvent;

interface StoredOperation {
  digest: string;
  result: RecommendationSignalLedgerIngestResult;
}

interface StoredActiveEntry extends RecommendationSignalLedgerActiveEntry {
  occurredAtMillis: number;
}

interface StoredTombstone extends RecommendationSignalLedgerTombstone {
  occurredAtMillis: number;
}

const OPERATION_SET = new Set<string>(RECOMMENDATION_SIGNAL_LEDGER_OPERATIONS);
const RETRACTION_REASON_SET = new Set<string>(RECOMMENDATION_SIGNAL_RETRACTION_REASONS);
const DEFAULT_NAMESPACE = "recommendation-signal-ledger.v1";
const DEFAULT_MAX_OPERATIONS = 100_000;
const MAX_ID_LENGTH = 1_024;
const MAX_NAMESPACE_LENGTH = 128;
const MAX_SALT_LENGTH = 512;
const MAX_OPERATIONS = 1_000_000;
const OPERATION_KEY_PREFIX = "signal-operation:";
const SOURCE_EVENT_KEY_PREFIX = "signal-source-event:";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function timestamp(value: unknown, message: string): { value: string; millis: number } {
  const normalized = boundedString(value, MAX_ID_LENGTH, message);
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) throw new TypeError(message);
  return { value: normalized, millis };
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_OPERATIONS) {
    throw new TypeError("Invalid recommendation signal ledger operation limit.");
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize non-finite signal ledger value.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Cannot canonicalize unsupported signal ledger value.");
}

function normalizeEvent(input: RecommendationSignalLedgerEventInput): NormalizedEvent {
  if (!isPlainRecord(input) || typeof input.operation !== "string" || !OPERATION_SET.has(input.operation)) {
    throw new TypeError("Invalid recommendation signal ledger event.");
  }

  const operationId = boundedString(input.operationId, MAX_ID_LENGTH, "Invalid recommendation signal ledger operation ID.");
  const sourceEventId = boundedString(input.sourceEventId, MAX_ID_LENGTH, "Invalid recommendation signal ledger source event ID.");
  const occurredAt = timestamp(input.occurredAt, "Invalid recommendation signal ledger timestamp.");

  if (input.operation === "apply") {
    const signal = normalizeRecommendationInterestSignal(input.signal);
    if (signal.expiresAt !== undefined) {
      timestamp(signal.expiresAt, "Invalid recommendation signal ledger signal expiration timestamp.");
    }

    return Object.freeze({
      operation: "apply",
      operationId,
      sourceEventId,
      occurredAt: occurredAt.value,
      occurredAtMillis: occurredAt.millis,
      signal
    });
  }

  const retractsSourceEventId = boundedString(
    input.retractsSourceEventId,
    MAX_ID_LENGTH,
    "Invalid recommendation signal ledger retraction target ID."
  );
  if (typeof input.reason !== "string" || !RETRACTION_REASON_SET.has(input.reason)) {
    throw new TypeError("Invalid recommendation signal ledger retraction reason.");
  }

  return Object.freeze({
    operation: "retract",
    operationId,
    sourceEventId,
    retractsSourceEventId,
    occurredAt: occurredAt.value,
    occurredAtMillis: occurredAt.millis,
    reason: input.reason as RecommendationSignalRetractionReason
  });
}

function freezeResult(result: RecommendationSignalLedgerIngestResult): RecommendationSignalLedgerIngestResult {
  return Object.freeze({ ...result });
}

function cloneActive(entry: StoredActiveEntry): RecommendationSignalLedgerActiveEntry {
  return Object.freeze({
    sourceEventKey: entry.sourceEventKey,
    operationKey: entry.operationKey,
    occurredAt: entry.occurredAt,
    signal: entry.signal
  });
}

function cloneTombstone(entry: StoredTombstone): RecommendationSignalLedgerTombstone {
  return Object.freeze({
    sourceEventKey: entry.sourceEventKey,
    operationKey: entry.operationKey,
    occurredAt: entry.occurredAt,
    reason: entry.reason
  });
}

function shouldReplaceTombstone(
  existing: StoredTombstone | undefined,
  occurredAtMillis: number,
  operationKey: string
): boolean {
  if (existing === undefined) return true;
  if (occurredAtMillis !== existing.occurredAtMillis) {
    return occurredAtMillis > existing.occurredAtMillis;
  }
  return operationKey.localeCompare(existing.operationKey) > 0;
}

export function createInMemoryRecommendationSignalLedger(
  options: RecommendationSignalLedgerOptions = {}
): RecommendationSignalLedger {
  if (!isPlainRecord(options)) throw new TypeError("Invalid recommendation signal ledger options.");

  const namespace = options.namespace === undefined
    ? DEFAULT_NAMESPACE
    : boundedString(options.namespace, MAX_NAMESPACE_LENGTH, "Invalid recommendation signal ledger namespace.");
  const salt = options.salt === undefined
    ? ""
    : boundedString(options.salt, MAX_SALT_LENGTH, "Invalid recommendation signal ledger salt.");
  const maxOperations = positiveInteger(options.maxOperations, DEFAULT_MAX_OPERATIONS);

  const operations = new Map<string, StoredOperation>();
  const active = new Map<string, StoredActiveEntry>();
  const tombstones = new Map<string, StoredTombstone>();

  const keyForOperation = (operationId: string): string =>
    `${OPERATION_KEY_PREFIX}${sha256Hex(`${namespace}\u0000${salt}\u0000operation\u0000${operationId}`)}`;
  const keyForSourceEvent = (sourceEventId: string): string =>
    `${SOURCE_EVENT_KEY_PREFIX}${sha256Hex(`${namespace}\u0000${salt}\u0000source\u0000${sourceEventId}`)}`;

  function counts(): Pick<RecommendationSignalLedgerIngestResult, "activeSignalCount" | "tombstoneCount"> {
    return { activeSignalCount: active.size, tombstoneCount: tombstones.size };
  }

  function ingest(eventInput: RecommendationSignalLedgerEventInput): RecommendationSignalLedgerIngestResult {
    const event = normalizeEvent(eventInput);
    const operationKey = keyForOperation(event.operationId);
    const sourceEventKey = keyForSourceEvent(event.sourceEventId);
    const digest = sha256Hex(stableStringify(event));
    const prior = operations.get(operationKey);

    if (prior !== undefined) {
      if (prior.digest !== digest) {
        throw new TypeError("Conflicting recommendation signal ledger operation ID.");
      }
      return freezeResult({ ...prior.result, decision: "duplicate", ...counts() });
    }
    if (operations.size >= maxOperations) {
      throw new RangeError("Recommendation signal ledger operation limit exceeded.");
    }

    let result: RecommendationSignalLedgerIngestResult;
    if (event.operation === "apply") {
      const targetKey = keyForSourceEvent(event.sourceEventId);
      if (tombstones.has(targetKey)) {
        result = freezeResult({
          decision: "suppressed_by_retraction",
          operationKey,
          sourceEventKey: targetKey,
          ...counts()
        });
      } else {
        const existing = active.get(targetKey);
        if (existing !== undefined) {
          throw new TypeError("Conflicting recommendation signal ledger source event ID.");
        }
        active.set(targetKey, Object.freeze({
          sourceEventKey: targetKey,
          operationKey,
          occurredAt: event.occurredAt,
          occurredAtMillis: event.occurredAtMillis,
          signal: event.signal
        }));
        result = freezeResult({ decision: "applied", operationKey, sourceEventKey: targetKey, ...counts() });
      }
    } else {
      const targetKey = keyForSourceEvent(event.retractsSourceEventId);
      const existingTombstone = tombstones.get(targetKey);
      if (shouldReplaceTombstone(existingTombstone, event.occurredAtMillis, operationKey)) {
        tombstones.set(targetKey, Object.freeze({
          sourceEventKey: targetKey,
          operationKey,
          occurredAt: event.occurredAt,
          occurredAtMillis: event.occurredAtMillis,
          reason: event.reason
        }));
      }
      active.delete(targetKey);
      result = freezeResult({ decision: "retracted", operationKey, sourceEventKey: targetKey, ...counts() });
    }

    operations.set(operationKey, Object.freeze({ digest, result }));
    return result;
  }

  function listActiveSignals(optionsInput: { now?: string } = {}): readonly RecommendationSignalLedgerActiveEntry[] {
    if (!isPlainRecord(optionsInput)) throw new TypeError("Invalid recommendation signal ledger read options.");
    const nowMillis = optionsInput.now === undefined
      ? Date.now()
      : timestamp(optionsInput.now, "Invalid recommendation signal ledger read timestamp.").millis;

    const entries = [...active.values()]
      .filter((entry) => entry.signal.expiresAt === undefined || Date.parse(entry.signal.expiresAt) > nowMillis)
      .sort((left, right) => left.occurredAtMillis - right.occurredAtMillis || left.sourceEventKey.localeCompare(right.sourceEventKey))
      .map(cloneActive);
    return Object.freeze(entries);
  }

  function snapshot(optionsInput: { now?: string } = {}): RecommendationSignalLedgerSnapshot {
    const activeSignals = listActiveSignals(optionsInput);
    const tombstoneValues = [...tombstones.values()]
      .sort((left, right) => left.occurredAtMillis - right.occurredAtMillis || left.sourceEventKey.localeCompare(right.sourceEventKey))
      .map(cloneTombstone);
    return Object.freeze({
      activeSignals,
      tombstones: Object.freeze(tombstoneValues),
      operationCount: operations.size
    });
  }

  function ingestBatch(events: readonly RecommendationSignalLedgerEventInput[]): RecommendationSignalLedgerBatchResult {
    if (!Array.isArray(events)) throw new TypeError("Invalid recommendation signal ledger event batch.");
    const results: RecommendationSignalLedgerIngestResult[] = [];
    let appliedCount = 0;
    let retractedCount = 0;
    let duplicateCount = 0;
    let suppressedCount = 0;

    for (const event of events) {
      const result = ingest(event);
      results.push(result);
      if (result.decision === "applied") appliedCount += 1;
      else if (result.decision === "retracted") retractedCount += 1;
      else if (result.decision === "duplicate") duplicateCount += 1;
      else suppressedCount += 1;
    }

    return Object.freeze({
      results: Object.freeze(results),
      appliedCount,
      retractedCount,
      duplicateCount,
      suppressedCount,
      activeSignalCount: active.size,
      tombstoneCount: tombstones.size
    });
  }

  return Object.freeze({
    ingest,
    ingestBatch,
    listActiveSignals,
    snapshot,
    clear(): void {
      operations.clear();
      active.clear();
      tombstones.clear();
    }
  });
}
