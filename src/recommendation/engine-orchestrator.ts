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

export interface RecommendationEnginePersistedSubjectState {
  events: readonly RecommendationSignalLedgerEventInput[];
  deletedAt?: string;
}

export interface RecommendationEngineSubjectStateStore {
  load(subjectId: string): Promise<RecommendationEnginePersistedSubjectState | undefined>;
  save(subjectId: string, state: RecommendationEnginePersistedSubjectState): Promise<void>;
}

export interface RecommendationEngineOrchestratorOptions {
  profileStore: RecommendationProfileSignalReplacementStore;
  stateStore?: RecommendationEngineSubjectStateStore;
  allowEmptySubjectInitialization?: boolean;
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
  replayBarrierInstalled: true;
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
const OWNED_DELETION_TARGETS = new Set(["profile", "event_history"]);

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
    candidate.targets.length !== 2 ||
    new Set(candidate.targets).size !== 2 ||
    candidate.targets.some((target) => !OWNED_DELETION_TARGETS.has(target))
  ) {
    throw new TypeError("Recommendation engine deletion supports exactly profile and event history.");
  }
  return Object.freeze({
    subjectId: id,
    requestedAt,
    scope: "recommendation_derived_data",
    targets: Object.freeze(["profile", "event_history"])
  });
}

function cloneEvent(event: RecommendationSignalLedgerEventInput): RecommendationSignalLedgerEventInput {
  return event.operation === "apply"
    ? Object.freeze({ ...event, signal: event.signal })
    : Object.freeze({ ...event });
}

function freezeState(state: RecommendationEnginePersistedSubjectState): RecommendationEnginePersistedSubjectState {
  const frozen: RecommendationEnginePersistedSubjectState = {
    events: Object.freeze(state.events.map(cloneEvent))
  };
  if (state.deletedAt !== undefined) frozen.deletedAt = timestamp(state.deletedAt);
  return Object.freeze(frozen);
}

function createInMemoryStateStore(): RecommendationEngineSubjectStateStore {
  const states = new Map<string, RecommendationEnginePersistedSubjectState>();
  return Object.freeze({
    async load(id) {
      return states.get(id);
    },
    async save(id, state) {
      states.set(id, freezeState(state));
    }
  });
}

export function createRecommendationEngineOrchestrator(
  options: RecommendationEngineOrchestratorOptions
): RecommendationEngineOrchestrator {
  if (!isPlainRecord(options) || !isPlainRecord(options.profileStore)) {
    throw new TypeError("Invalid recommendation engine orchestrator options.");
  }
  if (options.stateStore !== undefined && !isPlainRecord(options.stateStore)) {
    throw new TypeError("Invalid recommendation engine subject state store.");
  }
  if (options.allowEmptySubjectInitialization !== undefined && typeof options.allowEmptySubjectInitialization !== "boolean") {
    throw new TypeError("Invalid recommendation engine empty-subject initialization option.");
  }

  const nowProvider = options.now ?? (() => new Date().toISOString());
  if (typeof nowProvider !== "function") throw new TypeError("Invalid recommendation engine clock.");
  const batchLimit = maxBatchSize(options.maxEventsPerBatch);
  const stateStore = options.stateStore ?? createInMemoryStateStore();
  const allowEmptyInitialization = options.allowEmptySubjectInitialization === true;
  const states = new Map<string, RecommendationEnginePersistedSubjectState>();
  const ledgers = new Map<string, RecommendationSignalLedger>();
  const tails = new Map<string, Promise<void>>();
  const application = createRecommendationProfileApplicationOrchestrator({
    profileStore: options.profileStore,
    now: nowProvider
  });

  function buildLedger(events: readonly RecommendationSignalLedgerEventInput[]): RecommendationSignalLedger {
    const ledger = createInMemoryRecommendationSignalLedger(options.ledgerOptions);
    if (events.length > 0) ledger.ingestBatch(events);
    return ledger;
  }

  async function loadState(id: string): Promise<RecommendationEnginePersistedSubjectState> {
    const cached = states.get(id);
    if (cached !== undefined) return cached;
    const restored = await stateStore.load(id);
    if (restored === undefined) {
      if (!allowEmptyInitialization) {
        throw new Error("Recommendation engine ledger recovery is required before subject processing.");
      }
      const empty = freezeState({ events: [] });
      states.set(id, empty);
      ledgers.set(id, buildLedger(empty.events));
      return empty;
    }
    if (!isPlainRecord(restored) || !Array.isArray(restored.events)) {
      throw new TypeError("Invalid recommendation engine persisted subject state.");
    }
    const normalized = freezeState(restored);
    const ledger = buildLedger(normalized.events);
    states.set(id, normalized);
    ledgers.set(id, ledger);
    return normalized;
  }

  async function requireActiveState(id: string): Promise<RecommendationEnginePersistedSubjectState> {
    const state = await loadState(id);
    if (state.deletedAt !== undefined) {
      throw new Error("Recommendation engine subject is blocked by a deletion replay barrier.");
    }
    return state;
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
        const state = await requireActiveState(id);
        const candidate = buildLedger(state.events);
        const ingestion = candidate.ingestBatch(input.events);
        const acceptedEvents = input.events.filter((_, index) => ingestion.results[index]?.decision !== "duplicate");
        const nextState = freezeState({ events: [...state.events, ...acceptedEvents] });
        await stateStore.save(id, nextState);
        states.set(id, nextState);
        ledgers.set(id, candidate);
        const applicationResult = await application.synchronize({ subjectId: id, ledger: candidate, now });
        return Object.freeze({ subjectId: id, ingestion, application: applicationResult });
      });
    },

    async synchronize(input: RecommendationEngineSynchronizeInput): Promise<RecommendationProfileApplicationResult> {
      if (!isPlainRecord(input)) throw new TypeError("Invalid recommendation engine synchronize input.");
      const id = subjectId(input.subjectId);
      const now = resolveNow(input.now);
      return runSerialized(id, async () => {
        const state = await requireActiveState(id);
        const ledger = ledgers.get(id) ?? buildLedger(state.events);
        ledgers.set(id, ledger);
        return application.synchronize({ subjectId: id, ledger, now });
      });
    },

    async readProfile(rawSubjectId: string): Promise<RecommendationProfileSnapshot> {
      const id = subjectId(rawSubjectId);
      return runSerialized(id, () => options.profileStore.readProfile(id));
    },

    async readLedgerSnapshot(input: RecommendationEngineSynchronizeInput): Promise<RecommendationSignalLedgerSnapshot> {
      if (!isPlainRecord(input)) throw new TypeError("Invalid recommendation engine ledger snapshot input.");
      const id = subjectId(input.subjectId);
      const now = resolveNow(input.now);
      return runSerialized(id, async () => {
        const state = await requireActiveState(id);
        const ledger = ledgers.get(id) ?? buildLedger(state.events);
        ledgers.set(id, ledger);
        return ledger.snapshot({ now });
      });
    },

    async deleteSubject(rawIntent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationEngineDeletionResult> {
      const intent = validateDeletionIntent(rawIntent);
      return runSerialized(intent.subjectId, async () => {
        const barrier = freezeState({ events: [], deletedAt: intent.requestedAt });
        await stateStore.save(intent.subjectId, barrier);
        states.set(intent.subjectId, barrier);
        ledgers.delete(intent.subjectId);
        const profile = await options.profileStore.deleteProfile(intent);
        return Object.freeze({
          subjectId: intent.subjectId,
          profile,
          ledgerCleared: true as const,
          replayBarrierInstalled: true as const
        });
      });
    }
  });
}
