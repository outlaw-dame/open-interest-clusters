import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import {
  createRecommendationProfileApplicationOrchestrator,
  type RecommendationProfileApplicationResult
} from "./profile-application-orchestrator.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import type { RecommendationProfileSignalReplacementStore } from "./profile-replacement-store.js";
import {
  createInMemoryRecommendationSignalLedger,
  type RecommendationSignalLedger,
  type RecommendationSignalLedgerBatchResult,
  type RecommendationSignalLedgerEventInput,
  type RecommendationSignalLedgerOptions,
  type RecommendationSignalLedgerSnapshot
} from "./signal-ledger.js";

export interface RecommendationEngineOrchestratorOptions {
  profileStore: RecommendationProfileSignalReplacementStore;
  ledgerOptions?: RecommendationSignalLedgerOptions;
  now?: () => string;
  maxEventsPerBatch?: number;
}

export interface RecommendationEngineProcessInput {
  subjectId: string;
  events: readonly RecommendationSignalLedgerEventInput[];
  now?: string;
}

export interface RecommendationEngineSynchronizeInput {
  subjectId: string;
  now?: string;
}

export interface RecommendationEngineProcessResult {
  subjectId: string;
  ingestion: RecommendationSignalLedgerBatchResult;
  application: RecommendationProfileApplicationResult;
}

export interface RecommendationEngineDeletionResult {
  subjectId: string;
  profile: RecommendationProfileSnapshot;
  ledgerCleared: true;
}

export interface RecommendationEngineOrchestrator {
  process(input: RecommendationEngineProcessInput): Promise<RecommendationEngineProcessResult>;
  synchronize(input: RecommendationEngineSynchronizeInput): Promise<RecommendationProfileApplicationResult>;
  readProfile(subjectId: string): Promise<RecommendationProfileSnapshot>;
  readLedgerSnapshot(input: RecommendationEngineSynchronizeInput): Promise<RecommendationSignalLedgerSnapshot>;
  deleteSubject(intent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationEngineDeletionResult>;
}

const DEFAULT_MAX_EVENTS_PER_BATCH = 10_000;
const MAX_EVENTS_PER_BATCH = 100_000;
const MAX_SUBJECT_ID_LENGTH = 512;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function subjectId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_SUBJECT_ID_LENGTH ||
    /[\x00-\x1F\x7F]/u.test(value)
  ) {
    throw new TypeError("Invalid recommendation engine subject ID.");
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("Invalid recommendation engine timestamp.");
  }
  return value;
}

function maxBatchSize(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_EVENTS_PER_BATCH;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_EVENTS_PER_BATCH) {
    throw new TypeError("Invalid recommendation engine event batch limit.");
  }
  return value;
}

function validateDeletionIntent(value: unknown): RecommendationDerivedDataDeletionIntent {
  if (!isPlainRecord(value)) throw new TypeError("Invalid recommendation engine deletion intent.");
  const candidate = value as Partial<RecommendationDerivedDataDeletionIntent>;
  const id = subjectId(candidate.subjectId);
  const requestedAt = timestamp(candidate.requestedAt);
  if (
    candidate.scope !== "recommendation_derived_data" ||
    !Array.isArray(candidate.targets) ||
    !candidate.targets.includes("profile") ||
    !candidate.targets.includes("event_history")
  ) {
    throw new TypeError("Recommendation engine deletion must include profile and event history.");
  }
  return Object.freeze({
    subjectId: id,
    requestedAt,
    scope: "recommendation_derived_data",
    targets: Object.freeze([...candidate.targets])
  }) as RecommendationDerivedDataDeletionIntent;
}

export function createRecommendationEngineOrchestrator(
  options: RecommendationEngineOrchestratorOptions
): RecommendationEngineOrchestrator {
  if (!isPlainRecord(options) || !isPlainRecord(options.profileStore)) {
    throw new TypeError("Invalid recommendation engine orchestrator options.");
  }
  const nowProvider = options.now ?? (() => new Date().toISOString());
  if (typeof nowProvider !== "function") throw new TypeError("Invalid recommendation engine clock.");
  const batchLimit = maxBatchSize(options.maxEventsPerBatch);
  const ledgers = new Map<string, RecommendationSignalLedger>();
  const tails = new Map<string, Promise<void>>();
  const application = createRecommendationProfileApplicationOrchestrator({
    profileStore: options.profileStore,
    now: nowProvider
  });

  function ledgerFor(id: string): RecommendationSignalLedger {
    const existing = ledgers.get(id);
    if (existing !== undefined) return existing;
    const created = createInMemoryRecommendationSignalLedger(options.ledgerOptions);
    ledgers.set(id, created);
    return created;
  }

  async function runSerialized<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = tails.get(id) ?? Promise.resolve();
    const ready = prior.catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = ready.then(() => gate);
    tails.set(id, tail);
    await ready;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(id) === tail) tails.delete(id);
    }
  }

  function resolveNow(value: unknown): string {
    return timestamp(value ?? nowProvider());
  }

  return Object.freeze({
    async process(input: RecommendationEngineProcessInput): Promise<RecommendationEngineProcessResult> {
      if (!isPlainRecord(input) || !Array.isArray(input.events)) {
        throw new TypeError("Invalid recommendation engine process input.");
      }
      const id = subjectId(input.subjectId);
      if (input.events.length > batchLimit) throw new RangeError("Recommendation engine event batch limit exceeded.");
      const now = resolveNow(input.now);

      return runSerialized(id, async () => {
        const ledger = ledgerFor(id);
        const ingestion = ledger.ingestBatch(input.events);
        const applicationResult = await application.synchronize({ subjectId: id, ledger, now });
        return Object.freeze({ subjectId: id, ingestion, application: applicationResult });
      });
    },

    async synchronize(input: RecommendationEngineSynchronizeInput): Promise<RecommendationProfileApplicationResult> {
      if (!isPlainRecord(input)) throw new TypeError("Invalid recommendation engine synchronize input.");
      const id = subjectId(input.subjectId);
      const now = resolveNow(input.now);
      return runSerialized(id, () => application.synchronize({ subjectId: id, ledger: ledgerFor(id), now }));
    },

    async readProfile(rawSubjectId: string): Promise<RecommendationProfileSnapshot> {
      const id = subjectId(rawSubjectId);
      return runSerialized(id, () => options.profileStore.readProfile(id));
    },

    async readLedgerSnapshot(input: RecommendationEngineSynchronizeInput): Promise<RecommendationSignalLedgerSnapshot> {
      if (!isPlainRecord(input)) throw new TypeError("Invalid recommendation engine ledger snapshot input.");
      const id = subjectId(input.subjectId);
      const now = resolveNow(input.now);
      return runSerialized(id, async () => ledgerFor(id).snapshot({ now }));
    },

    async deleteSubject(rawIntent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationEngineDeletionResult> {
      const intent = validateDeletionIntent(rawIntent);
      return runSerialized(intent.subjectId, async () => {
        const profile = await options.profileStore.deleteProfile(intent);
        const ledger = ledgers.get(intent.subjectId);
        ledger?.clear();
        ledgers.delete(intent.subjectId);
        return Object.freeze({ subjectId: intent.subjectId, profile, ledgerCleared: true as const });
      });
    }
  });
}
