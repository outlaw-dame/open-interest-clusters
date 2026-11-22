import { sha256Hex } from "../runtime/hash.js";
import { executeWithRetry } from "../utils/retry-policy.js";
import {
  assertRecommendationTimestampNotAhead,
  listRecommendationLifecycleExcludedCandidateIds,
  listRecommendationLifecycleExcludedSetSourceIds,
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidateLifecycleEvent
} from "./candidate-lifecycle.js";
import type {
  RecommendationDerivedStateInvalidationOrchestrator,
  RecommendationDerivedStateProcessResult,
  RecommendationDerivedStatePropagationResult
} from "./derived-state-invalidation-orchestrator.js";
import type { RecommendationEngineOrchestrator } from "./engine-orchestrator.js";
import type {
  RecommendationFirstSessionOrchestrator,
  RecommendationFirstSessionRequest,
  RecommendationFirstSessionResult
} from "./first-session-orchestrator.js";
import type { RecommendationInterestSignal } from "./interest-signal.js";
import { getSharedRecommendationKeyedSerializer } from "./keyed-serializer.js";
import {
  buildRecommendationOnboardingSignals,
  type RecommendationOnboardingProfileSeedInput
} from "./onboarding-profile-seed.js";
import { assertValidRecommendationProfileSubjectId } from "./profile-store-persistence-key.js";
import type {
  RecommendationSignalLedgerEventInput,
  RecommendationSignalRetractionReason
} from "./signal-ledger.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

/** Reasons a caller may give when withdrawing every onboarding selection at once. */
export const RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS = ["source_retracted", "consent_revoked"] as const;
export type RecommendationOnboardingWithdrawalReason = typeof RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS[number];

export type RecommendationOnboardingSelectionChangeInput =
  Omit<RecommendationOnboardingProfileSeedInput, "profileStore"> & { now?: string };

export interface RecommendationOnboardingSelectionChangeResult {
  subjectId: string;
  /** Targets written for the first time, or again after an earlier withdrawal or expiry. */
  added: readonly string[];
  /** Targets whose live signal was replaced because its strength, confidence, boundary or expiry changed. */
  updated: readonly string[];
  /** Targets whose live signal was retracted because the selection no longer contains them. */
  removed: readonly string[];
  /** Targets that already matched the live signal and were left alone. */
  unchangedCount: number;
  eventCount: number;
  processing: RecommendationDerivedStateProcessResult;
}

export interface RecommendationOnboardingWithdrawalInput {
  subjectId: string;
  reason: RecommendationOnboardingWithdrawalReason;
  now?: string;
}

export interface RecommendationOnboardingCandidateReportResult {
  subjectId: string;
  acceptedEventCount: number;
  excludedCandidateIds: readonly string[];
  propagation: RecommendationDerivedStatePropagationResult | undefined;
}

export interface RecommendationOnboardingRefreshInput {
  request: RecommendationFirstSessionRequest;
  /** Candidate facts that changed since the last run. Reported before the rerun, so caches are cleared first. */
  candidateEvents?: readonly RecommendationCandidateLifecycleEvent[];
  now?: string;
}

export interface RecommendationOnboardingRefreshResult {
  result: RecommendationFirstSessionResult;
  excludedCandidateIds: readonly string[];
  /** Curated-set source IDs left out because a set-level event was reported for them. */
  excludedSetSourceIds: readonly string[];
  propagation: RecommendationDerivedStatePropagationResult;
}

export interface RecommendationOnboardingLifecycleOptions {
  /** The invalidating wrapper around the engine. All writes go through it. */
  derived: Pick<RecommendationDerivedStateInvalidationOrchestrator, "process" | "repair" | "invalidateCandidateState">;
  /** The same engine the wrapper drives. Only used to read accepted event history. */
  engine: Pick<RecommendationEngineOrchestrator, "readEventHistory">;
  firstSession?: Pick<RecommendationFirstSessionOrchestrator, "execute">;
  now?: () => string;
}

export interface RecommendationOnboardingLifecycle {
  /**
   * Makes the subject's live onboarding signals match the given selection. Selections that disappeared
   * are retracted, edited ones are replaced, and untouched ones are not written again, so repeating
   * the same call changes nothing.
   */
  applySelection(input: RecommendationOnboardingSelectionChangeInput): Promise<RecommendationOnboardingSelectionChangeResult>;
  /** Retracts every live onboarding signal. Use `consent_revoked` when the user withdrew consent. */
  withdrawSelections(input: RecommendationOnboardingWithdrawalInput): Promise<RecommendationOnboardingSelectionChangeResult>;
  /** Records changed candidate facts: durably clears the candidate and explanation caches. */
  reportCandidateEvents(input: { subjectId: string; events: readonly RecommendationCandidateLifecycleEvent[]; now?: string }): Promise<RecommendationOnboardingCandidateReportResult>;
  /** Settles pending invalidation, reports candidate facts, then reruns the first session without the withdrawn candidates. */
  refresh(input: RecommendationOnboardingRefreshInput): Promise<RecommendationOnboardingRefreshResult>;
}

/** A few quick replans with jittered backoff. A lost race normally settles on the first one. */
const STALE_PLAN_RETRY = Object.freeze({ attempts: 5, initialDelayMs: 5, maxDelayMs: 100, jitterRatio: 0.5 });

/** Marks a failed write that happened while the ledger moved under the plan, so the plan can be redone. */
class StalePlanError extends Error {
  constructor(readonly original: unknown) { super("Onboarding plan was based on stale history."); }
}

const SOURCE_EVENT_PREFIX = "onboarding:v1:";
const OPERATION_PREFIX = "onboarding-op:v1:";
const SOURCE_EVENT_PATTERN = /^onboarding:v1:g(\d{1,9}):([0-9a-f]{64})$/u;
const WITHDRAWAL_REASON_SET = new Set<string>(RECOMMENDATION_ONBOARDING_WITHDRAWAL_REASONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function targetHash(signal: RecommendationInterestSignal): string {
  return sha256Hex(`${signal.target.kind}\u0000${signal.target.key}`);
}

function targetLabel(signal: RecommendationInterestSignal): string {
  return `${signal.target.kind}:${signal.target.key}`;
}

/** What makes two onboarding signals "the same selection". Audit fields and timestamps are left out on purpose. */
function contentDigest(signal: RecommendationInterestSignal): string {
  return sha256Hex(JSON.stringify([
    signal.target.kind, signal.target.key, signal.action, signal.polarity, signal.strength,
    signal.confidence, signal.dataUse, signal.privacyBoundary, signal.expiresAt ?? null
  ]));
}

function sourceEventIdFor(hash: string, generation: number): string {
  return `${SOURCE_EVENT_PREFIX}g${generation}:${hash}`;
}

interface LiveEntry { sourceEventId: string; generation: number; digest: string; label: string }
interface HistoryView {
  live: Map<string, LiveEntry[]>;
  nextGeneration: Map<string, number>;
}

/**
 * Replays the accepted history to find which onboarding signals are live. Signals are only recognized
 * when their event ID has the exact onboarding shape and its hash matches the signal's own target, so
 * an unrelated event cannot be mistaken for, or retracted as, an onboarding selection.
 */
function readHistory(history: readonly RecommendationSignalLedgerEventInput[], nowMs: number): HistoryView {
  const retracted = new Set<string>();
  for (const event of history) {
    if (event.operation === "retract") retracted.add(event.retractsSourceEventId);
  }
  const live = new Map<string, LiveEntry[]>();
  const nextGeneration = new Map<string, number>();
  for (const event of history) {
    if (event.operation !== "apply") continue;
    const match = SOURCE_EVENT_PATTERN.exec(event.sourceEventId);
    if (match === null) continue;
    const hash = match[2]!;
    if (hash !== targetHash(event.signal)) continue;
    const generation = Number.parseInt(match[1]!, 10);
    nextGeneration.set(hash, Math.max(nextGeneration.get(hash) ?? 0, generation + 1));
    if (retracted.has(event.sourceEventId)) continue;
    if (event.signal.expiresAt !== undefined && Date.parse(event.signal.expiresAt) <= nowMs) continue;
    const entries = live.get(hash) ?? [];
    entries.push({ sourceEventId: event.sourceEventId, generation, digest: contentDigest(event.signal), label: targetLabel(event.signal) });
    live.set(hash, entries);
  }
  return { live, nextGeneration };
}

function retractEvent(entry: LiveEntry, reason: RecommendationSignalRetractionReason, occurredAt: string): RecommendationSignalLedgerEventInput {
  const hash = sha256Hex(entry.sourceEventId);
  return Object.freeze({
    operation: "retract" as const,
    operationId: `${OPERATION_PREFIX}retract:${hash}`,
    sourceEventId: `${SOURCE_EVENT_PREFIX}retraction:${hash}`,
    retractsSourceEventId: entry.sourceEventId,
    occurredAt,
    reason
  });
}

function applyEvent(sourceEventId: string, signal: RecommendationInterestSignal, occurredAt: string): RecommendationSignalLedgerEventInput {
  return Object.freeze({
    operation: "apply" as const,
    operationId: `${OPERATION_PREFIX}apply:${sha256Hex(sourceEventId)}`,
    sourceEventId,
    occurredAt,
    signal
  });
}

export function createRecommendationOnboardingLifecycle(
  options: RecommendationOnboardingLifecycleOptions
): RecommendationOnboardingLifecycle {
  if (
    !isRecord(options) || !isRecord(options.derived) || !isRecord(options.engine) ||
    typeof options.derived.process !== "function" || typeof options.derived.repair !== "function" ||
    typeof options.derived.invalidateCandidateState !== "function" ||
    typeof options.engine.readEventHistory !== "function" ||
    (options.firstSession !== undefined && (!isRecord(options.firstSession) || typeof options.firstSession.execute !== "function")) ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new TypeError("Invalid recommendation onboarding lifecycle options.");
  }
  const clock = options.now ?? (() => new Date().toISOString());
  // Keyed by the engine, so every lifecycle built on one engine queues per subject in one line.
  const serializer = getSharedRecommendationKeyedSerializer(options.engine);

  const timestampMessage = "Invalid recommendation onboarding lifecycle timestamp.";

  /** A time given by the caller may not run ahead of the lifecycle clock by more than the allowed skew. */
  function timestamp(value: unknown): string {
    const current = normalizeStrictRfc3339Timestamp(clock(), timestampMessage);
    if (value === undefined) return current;
    const given = normalizeStrictRfc3339Timestamp(value, timestampMessage);
    assertRecommendationTimestampNotAhead(
      Date.parse(given),
      Date.parse(current),
      "Recommendation onboarding lifecycle time is too far ahead of the clock."
    );
    return given;
  }

  function historySignature(history: readonly RecommendationSignalLedgerEventInput[]): string {
    return history.map((event) => event.operationId).join("\u0000");
  }

  async function reconcile(
    subjectId: string,
    now: string,
    desired: ReadonlyMap<string, { signal: RecommendationInterestSignal; digest: string }>,
    withdrawalReason: RecommendationSignalRetractionReason
  ): Promise<RecommendationOnboardingSelectionChangeResult> {
    return executeWithRetry(
      () => reconcileOnce(subjectId, now, desired, withdrawalReason),
      {
        ...STALE_PLAN_RETRY,
        shouldRetry: ({ error }) => error instanceof StalePlanError
      }
    ).catch((error: unknown) => { throw error instanceof StalePlanError ? error.original : error; });
  }

  async function reconcileOnce(
    subjectId: string,
    now: string,
    desired: ReadonlyMap<string, { signal: RecommendationInterestSignal; digest: string }>,
    withdrawalReason: RecommendationSignalRetractionReason
  ): Promise<RecommendationOnboardingSelectionChangeResult> {
    const history = await options.engine.readEventHistory(subjectId);
    const view = readHistory(history, Date.parse(now));
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    let unchangedCount = 0;
    const events: RecommendationSignalLedgerEventInput[] = [];

    const hashes = [...new Set([...view.live.keys(), ...desired.keys()])].sort();
    for (const hash of hashes) {
      const live = view.live.get(hash) ?? [];
      const want = desired.get(hash);
      if (want === undefined) {
        for (const entry of live) events.push(retractEvent(entry, withdrawalReason, now));
        if (live.length > 0) removed.push(live[0]!.label);
        continue;
      }
      if (live.length === 1 && live[0]!.digest === want.digest) {
        unchangedCount += 1;
        continue;
      }
      for (const entry of live) events.push(retractEvent(entry, "corrected", now));
      const generation = view.nextGeneration.get(hash) ?? 0;
      events.push(applyEvent(sourceEventIdFor(hash, generation), want.signal, now));
      (live.length === 0 ? added : updated).push(targetLabel(want.signal));
    }

    // Always go through `process`, even with no events, so a pending invalidation from an earlier
    // crash is finished and the profile checkpoint is brought up to date.
    let processing: RecommendationDerivedStateProcessResult;
    try {
      processing = await options.derived.process({ subjectId, events, now });
    } catch (error) {
      // A writer outside this queue (another process, or a direct engine call) may have touched the
      // ledger after the history was read, which shows up as a ledger conflict. If the history really
      // moved, plan again from it. Any other failure is returned as is.
      if (error instanceof TypeError) {
        const latest = await options.engine.readEventHistory(subjectId);
        if (historySignature(latest) !== historySignature(history)) throw new StalePlanError(error);
      }
      throw error;
    }
    return Object.freeze({
      subjectId,
      added: Object.freeze(added.sort()),
      updated: Object.freeze(updated.sort()),
      removed: Object.freeze(removed.sort()),
      unchangedCount,
      eventCount: events.length,
      processing
    });
  }

  async function report(
    subjectId: string,
    rawEvents: readonly RecommendationCandidateLifecycleEvent[],
    now: string
  ): Promise<RecommendationOnboardingCandidateReportResult> {
    const events = normalizeRecommendationCandidateLifecycleEvents(rawEvents, { now });
    if (events.length === 0) {
      return Object.freeze({ subjectId, acceptedEventCount: 0, excludedCandidateIds: Object.freeze([]), propagation: undefined });
    }
    const propagation = await options.derived.invalidateCandidateState({ subjectId, occurredAt: now });
    return Object.freeze({
      subjectId,
      acceptedEventCount: events.length,
      excludedCandidateIds: listRecommendationLifecycleExcludedCandidateIds(events),
      propagation
    });
  }

  return Object.freeze({
    async applySelection(input: RecommendationOnboardingSelectionChangeInput) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation onboarding selection change.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      // A profile store would give the seed a second write path that the ledger cannot retract.
      // The type already forbids it, so this guards untyped callers.
      if ("profileStore" in input) throw new TypeError("Recommendation onboarding selection changes cannot take a profile store.");
      const { now: rawNow, ...seedInput } = input;
      const now = timestamp(rawNow);
      return serializer.run(input.subjectId, async () => {
        // The seed does the catalog, sensitivity and consent checks. Consent is enforced on every
        // call, so a policy that no longer allows personalization stops the change before any write.
        const seed = await buildRecommendationOnboardingSignals(seedInput);
        const desired = new Map<string, { signal: RecommendationInterestSignal; digest: string }>();
        for (const signal of seed.signals) {
          const hash = targetHash(signal);
          if (desired.has(hash)) throw new TypeError("Recommendation onboarding selection produced a duplicate target.");
          desired.set(hash, { signal, digest: contentDigest(signal) });
        }
        return reconcile(input.subjectId, now, desired, "source_retracted");
      });
    },

    async withdrawSelections(input: RecommendationOnboardingWithdrawalInput) {
      if (!isRecord(input) || typeof input.reason !== "string" || !WITHDRAWAL_REASON_SET.has(input.reason)) {
        throw new TypeError("Invalid recommendation onboarding withdrawal.");
      }
      assertValidRecommendationProfileSubjectId(input.subjectId);
      const now = timestamp(input.now);
      return serializer.run(input.subjectId, () => reconcile(input.subjectId, now, new Map(), input.reason));
    },

    async reportCandidateEvents(input: { subjectId: string; events: readonly RecommendationCandidateLifecycleEvent[]; now?: string }) {
      if (!isRecord(input)) throw new TypeError("Invalid recommendation onboarding candidate report.");
      assertValidRecommendationProfileSubjectId(input.subjectId);
      const now = timestamp(input.now);
      return serializer.run(input.subjectId, () => report(input.subjectId, input.events, now));
    },

    async refresh(input: RecommendationOnboardingRefreshInput) {
      if (options.firstSession === undefined) {
        throw new TypeError("Recommendation onboarding refresh requires a first-session orchestrator.");
      }
      if (!isRecord(input) || !isRecord(input.request)) throw new TypeError("Invalid recommendation onboarding refresh input.");
      const subjectId = input.request.subjectId;
      assertValidRecommendationProfileSubjectId(subjectId);
      const now = timestamp(input.now);
      const firstSession = options.firstSession;
      return serializer.run(subjectId, async () => {
        const events = input.candidateEvents === undefined
          ? undefined
          : normalizeRecommendationCandidateLifecycleEvents(input.candidateEvents, { now });
        // Finish whatever an earlier crash left behind before deciding what to serve.
        const propagation = events === undefined || events.length === 0
          ? await options.derived.repair(subjectId)
          : (await report(subjectId, events, now)).propagation!;
        const excluded = new Set(input.request.excludeCandidateIds ?? []);
        for (const id of listRecommendationLifecycleExcludedCandidateIds(events ?? [])) excluded.add(id);
        const excludedCandidateIds = Object.freeze([...excluded].sort());
        // Set-level events usually have no candidate ID, so those candidates are matched by the set's source ID.
        const sourceIds = new Set(input.request.excludeSourceIds ?? []);
        for (const id of listRecommendationLifecycleExcludedSetSourceIds(events ?? [])) sourceIds.add(id);
        const excludedSetSourceIds = Object.freeze([...sourceIds].sort());
        const result = await firstSession.execute({
          ...input.request,
          excludeCandidateIds: excludedCandidateIds,
          excludeSourceIds: excludedSetSourceIds
        });
        return Object.freeze({ result, excludedCandidateIds, excludedSetSourceIds, propagation });
      });
    }
  });
}
