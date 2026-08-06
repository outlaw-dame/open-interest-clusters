import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import type {
  RecommendationEngineDeletionResult,
  RecommendationEngineOrchestrator,
  RecommendationEngineProcessInput,
  RecommendationEngineProcessResult,
  RecommendationEngineSynchronizeInput
} from "./engine-orchestrator.js";
import type { RecommendationProfileApplicationResult } from "./profile-application-orchestrator.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import { sha256Hex } from "../runtime/hash.js";

export const RECOMMENDATION_DERIVED_STATE_TARGETS = [
  "embeddings",
  "candidate_cache",
  "explanation_cache"
] as const;
export type RecommendationDerivedStateTarget = typeof RECOMMENDATION_DERIVED_STATE_TARGETS[number];

export const RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS = [
  "profile_changed",
  "signal_retracted",
  "signal_expired",
  "deletion_requested"
] as const;
export type RecommendationDerivedStateInvalidationReason =
  typeof RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS[number];

export const RECOMMENDATION_DERIVED_STATE_TASK_PHASES = [
  "engine_deletion_pending",
  "derived_invalidation_pending"
] as const;
export type RecommendationDerivedStateTaskPhase =
  typeof RECOMMENDATION_DERIVED_STATE_TASK_PHASES[number];

export interface RecommendationDerivedStateInvalidationRequest {
  subjectId: string;
  target: RecommendationDerivedStateTarget;
  reason: RecommendationDerivedStateInvalidationReason;
  profileDigest: string;
  occurredAt: string;
}

export interface RecommendationDerivedStateInvalidator {
  invalidate(request: RecommendationDerivedStateInvalidationRequest): Promise<void>;
}

export interface RecommendationDerivedStateInvalidationTask {
  subjectId: string;
  reason: RecommendationDerivedStateInvalidationReason;
  profileDigest: string;
  occurredAt: string;
  pendingTargets: readonly RecommendationDerivedStateTarget[];
  phase?: RecommendationDerivedStateTaskPhase;
  deletionIntent?: RecommendationDerivedDataDeletionIntent;
}

export interface RecommendationDerivedStateInvalidationTaskStore {
  load(subjectId: string): Promise<RecommendationDerivedStateInvalidationTask | undefined>;
  save(task: RecommendationDerivedStateInvalidationTask): Promise<void>;
  delete(subjectId: string): Promise<void>;
}

export interface RecommendationDerivedStateCheckpointStore {
  load(subjectId: string): Promise<string | undefined>;
  save(subjectId: string, profileDigest: string): Promise<void>;
  delete(subjectId: string): Promise<void>;
}

export interface RecommendationDerivedStateInvalidationOrchestratorOptions {
  engine: Pick<
    RecommendationEngineOrchestrator,
    "process" | "synchronize" | "readProfile" | "deleteSubject"
  >;
  invalidators: Readonly<Record<RecommendationDerivedStateTarget, RecommendationDerivedStateInvalidator>>;
  taskStore?: RecommendationDerivedStateInvalidationTaskStore;
  checkpointStore?: RecommendationDerivedStateCheckpointStore;
  now?: () => string;
}

export interface RecommendationDerivedStatePropagationResult {
  changed: boolean;
  reason?: RecommendationDerivedStateInvalidationReason;
  invalidatedTargets: readonly RecommendationDerivedStateTarget[];
  profileDigest: string;
}

export interface RecommendationDerivedStateProcessResult {
  engine: RecommendationEngineProcessResult;
  propagation: RecommendationDerivedStatePropagationResult;
}

export interface RecommendationDerivedStateSynchronizeResult {
  application: RecommendationProfileApplicationResult;
  propagation: RecommendationDerivedStatePropagationResult;
}

export interface RecommendationDerivedStateDeletionResult {
  engine: RecommendationEngineDeletionResult;
  propagation: RecommendationDerivedStatePropagationResult;
}

export interface RecommendationDerivedStateInvalidationOrchestrator {
  process(input: RecommendationEngineProcessInput): Promise<RecommendationDerivedStateProcessResult>;
  synchronize(input: RecommendationEngineSynchronizeInput): Promise<RecommendationDerivedStateSynchronizeResult>;
  repair(subjectId: string): Promise<RecommendationDerivedStatePropagationResult>;
  deleteSubject(intent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationDerivedStateDeletionResult>;
}

export class RecommendationDerivedStateInvalidationPendingError extends Error {
  readonly pendingTargets: readonly RecommendationDerivedStateTarget[];

  constructor(pendingTargets: readonly RecommendationDerivedStateTarget[]) {
    super("Recommendation derived-state invalidation remains pending.");
    this.name = "RecommendationDerivedStateInvalidationPendingError";
    this.pendingTargets = Object.freeze([...pendingTargets]);
  }
}

const TARGET_SET = new Set<string>(RECOMMENDATION_DERIVED_STATE_TARGETS);
const REASON_SET = new Set<string>(RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS);
const PHASE_SET = new Set<string>(RECOMMENDATION_DERIVED_STATE_TASK_PHASES);
const MAX_SUBJECT_ID_LENGTH = 512;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const DELETION_TARGET_SET = new Set(["profile", "event_history"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSubjectId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_SUBJECT_ID_LENGTH ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError("Invalid recommendation derived-state subject ID.");
  }
  return value;
}

function validateTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError("Invalid recommendation derived-state timestamp.");
  }
  return value;
}

function validateDigest(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    throw new TypeError("Invalid recommendation derived-state profile digest.");
  }
  return value;
}

function validateTarget(value: unknown): RecommendationDerivedStateTarget {
  if (typeof value !== "string" || !TARGET_SET.has(value)) {
    throw new TypeError("Invalid recommendation derived-state target.");
  }
  return value as RecommendationDerivedStateTarget;
}

function validateReason(value: unknown): RecommendationDerivedStateInvalidationReason {
  if (typeof value !== "string" || !REASON_SET.has(value)) {
    throw new TypeError("Invalid recommendation derived-state invalidation reason.");
  }
  return value as RecommendationDerivedStateInvalidationReason;
}

function validatePhase(value: unknown): RecommendationDerivedStateTaskPhase {
  if (typeof value !== "string" || !PHASE_SET.has(value)) {
    throw new TypeError("Invalid recommendation derived-state task phase.");
  }
  return value as RecommendationDerivedStateTaskPhase;
}

function cloneDeletionIntent(intent: RecommendationDerivedDataDeletionIntent): RecommendationDerivedDataDeletionIntent {
  if (!isPlainRecord(intent) || intent.scope !== "recommendation_derived_data") {
    throw new TypeError("Invalid recommendation deletion intent scope.");
  }
  if (
    !Array.isArray(intent.targets) ||
    intent.targets.length !== 2 ||
    new Set(intent.targets).size !== 2 ||
    intent.targets.some((target) => !DELETION_TARGET_SET.has(target))
  ) {
    throw new TypeError("Invalid recommendation deletion intent targets.");
  }
  return Object.freeze({
    subjectId: validateSubjectId(intent.subjectId),
    requestedAt: validateTimestamp(intent.requestedAt),
    scope: intent.scope,
    targets: Object.freeze(["profile", "event_history"] as const)
  });
}

function freezeTask(task: RecommendationDerivedStateInvalidationTask): RecommendationDerivedStateInvalidationTask {
  const targets = task.pendingTargets.map(validateTarget);
  if (new Set(targets).size !== targets.length) {
    throw new TypeError("Duplicate recommendation derived-state pending target.");
  }
  const phase = validatePhase(task.phase ?? "derived_invalidation_pending");
  const subjectId = validateSubjectId(task.subjectId);
  const normalized: RecommendationDerivedStateInvalidationTask = {
    subjectId,
    reason: validateReason(task.reason),
    profileDigest: validateDigest(task.profileDigest),
    occurredAt: validateTimestamp(task.occurredAt),
    pendingTargets: Object.freeze(targets),
    phase
  };
  if (task.deletionIntent !== undefined) {
    const deletionIntent = cloneDeletionIntent(task.deletionIntent);
    if (deletionIntent.subjectId !== subjectId) {
      throw new TypeError("Recommendation deletion task subject mismatch.");
    }
    normalized.deletionIntent = deletionIntent;
  }
  if (phase === "engine_deletion_pending" && normalized.deletionIntent === undefined) {
    throw new TypeError("Recommendation deletion task requires a deletion intent.");
  }
  return Object.freeze(normalized);
}

function createInMemoryTaskStore(): RecommendationDerivedStateInvalidationTaskStore {
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  return Object.freeze({
    async load(subjectId: string) {
      return tasks.get(validateSubjectId(subjectId));
    },
    async save(task: RecommendationDerivedStateInvalidationTask) {
      const normalized = freezeTask(task);
      tasks.set(normalized.subjectId, normalized);
    },
    async delete(subjectId: string) {
      tasks.delete(validateSubjectId(subjectId));
    }
  });
}

function createInMemoryCheckpointStore(): RecommendationDerivedStateCheckpointStore {
  const checkpoints = new Map<string, string>();
  return Object.freeze({
    async load(subjectId: string) {
      return checkpoints.get(validateSubjectId(subjectId));
    },
    async save(subjectId: string, digest: string) {
      checkpoints.set(validateSubjectId(subjectId), validateDigest(digest));
    },
    async delete(subjectId: string) {
      checkpoints.delete(validateSubjectId(subjectId));
    }
  });
}

function semanticProfileDigest(profile: RecommendationProfileSnapshot): string {
  const entries = [...profile.entries]
    .map((entry) => ({
      target: { kind: entry.target.kind, key: entry.target.key },
      score: entry.score,
      confidence: entry.confidence,
      signalCount: entry.signalCount,
      positiveSignalCount: entry.positiveSignalCount,
      negativeSignalCount: entry.negativeSignalCount,
      neutralSignalCount: entry.neutralSignalCount,
      privacyBoundaries: [...entry.privacyBoundaries].sort(),
      protocols: [...entry.protocols].sort(),
      sourceVisibilities: [...entry.sourceVisibilities].sort(),
      ...(entry.expiresAt === undefined ? {} : { expiresAt: entry.expiresAt })
    }))
    .sort((left, right) =>
      `${left.target.kind}\u0000${left.target.key}`.localeCompare(
        `${right.target.kind}\u0000${right.target.key}`
      )
    );
  return sha256Hex(JSON.stringify({
    schemaVersion: profile.schemaVersion,
    signalCount: profile.signalCount,
    entries
  }));
}

function propagation(
  changed: boolean,
  digest: string,
  invalidatedTargets: readonly RecommendationDerivedStateTarget[],
  reason?: RecommendationDerivedStateInvalidationReason
): RecommendationDerivedStatePropagationResult {
  const result: RecommendationDerivedStatePropagationResult = {
    changed,
    profileDigest: validateDigest(digest),
    invalidatedTargets: Object.freeze([...invalidatedTargets])
  };
  if (reason !== undefined) result.reason = reason;
  return Object.freeze(result);
}

function processReason(input: RecommendationEngineProcessInput): RecommendationDerivedStateInvalidationReason {
  return input.events.some((event) => event.operation === "retract")
    ? "signal_retracted"
    : "profile_changed";
}

export function createRecommendationDerivedStateInvalidationOrchestrator(
  options: RecommendationDerivedStateInvalidationOrchestratorOptions
): RecommendationDerivedStateInvalidationOrchestrator {
  if (!isPlainRecord(options) || !isPlainRecord(options.engine) || !isPlainRecord(options.invalidators)) {
    throw new TypeError("Invalid recommendation derived-state orchestrator options.");
  }
  for (const target of RECOMMENDATION_DERIVED_STATE_TARGETS) {
    const invalidator = options.invalidators[target];
    if (!isPlainRecord(invalidator) || typeof invalidator.invalidate !== "function") {
      throw new TypeError(`Invalid recommendation derived-state invalidator: ${target}.`);
    }
  }

  const taskStore = options.taskStore ?? createInMemoryTaskStore();
  const checkpointStore = options.checkpointStore ?? createInMemoryCheckpointStore();
  if (
    !isPlainRecord(taskStore) ||
    typeof taskStore.load !== "function" ||
    typeof taskStore.save !== "function" ||
    typeof taskStore.delete !== "function"
  ) {
    throw new TypeError("Invalid recommendation derived-state task store.");
  }
  if (
    !isPlainRecord(checkpointStore) ||
    typeof checkpointStore.load !== "function" ||
    typeof checkpointStore.save !== "function" ||
    typeof checkpointStore.delete !== "function"
  ) {
    throw new TypeError("Invalid recommendation derived-state checkpoint store.");
  }

  const nowProvider = options.now ?? (() => new Date().toISOString());
  if (typeof nowProvider !== "function") {
    throw new TypeError("Invalid recommendation derived-state clock.");
  }
  const tails = new Map<string, Promise<void>>();

  async function runSerialized<T>(subjectId: string, work: () => Promise<T>): Promise<T> {
    const id = validateSubjectId(subjectId);
    const prior = tails.get(id) ?? Promise.resolve();
    const ready = prior.catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = ready.then(() => gate);
    tails.set(id, tail);
    await ready;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(id) === tail) {
        tails.delete(id);
      }
    }
  }

  async function drainDerived(
    taskInput: RecommendationDerivedStateInvalidationTask,
    deletion: boolean
  ): Promise<RecommendationDerivedStatePropagationResult> {
    let task = freezeTask(taskInput);
    const completed: RecommendationDerivedStateTarget[] = [];
    for (const target of [...task.pendingTargets]) {
      try {
        await options.invalidators[target].invalidate(Object.freeze({
          subjectId: task.subjectId,
          target,
          reason: task.reason,
          profileDigest: task.profileDigest,
          occurredAt: task.occurredAt
        }));
      } catch {
        throw new RecommendationDerivedStateInvalidationPendingError(task.pendingTargets);
      }
      completed.push(target);
      task = freezeTask({
        ...task,
        phase: "derived_invalidation_pending",
        pendingTargets: task.pendingTargets.filter((item) => item !== target)
      });
      await taskStore.save(task);
    }

    if (deletion) {
      await checkpointStore.delete(task.subjectId);
    } else {
      await checkpointStore.save(task.subjectId, task.profileDigest);
    }
    await taskStore.delete(task.subjectId);
    return propagation(true, task.profileDigest, completed, task.reason);
  }

  async function resumeTask(
    taskInput: RecommendationDerivedStateInvalidationTask
  ): Promise<{
    propagation: RecommendationDerivedStatePropagationResult;
    engineDeletion?: RecommendationEngineDeletionResult;
  }> {
    let task = freezeTask(taskInput);
    let engineDeletion: RecommendationEngineDeletionResult | undefined;
    if (task.phase === "engine_deletion_pending") {
      engineDeletion = await options.engine.deleteSubject(task.deletionIntent!);
      task = freezeTask({
        ...task,
        phase: "derived_invalidation_pending",
        pendingTargets: RECOMMENDATION_DERIVED_STATE_TARGETS
      });
      await taskStore.save(task);
    }
    const result = await drainDerived(task, task.reason === "deletion_requested");
    return engineDeletion === undefined
      ? { propagation: result }
      : { propagation: result, engineDeletion };
  }

  async function recoverPending(subjectId: string): Promise<RecommendationDerivedStatePropagationResult | undefined> {
    const task = await taskStore.load(validateSubjectId(subjectId));
    if (task === undefined) {
      return undefined;
    }
    return (await resumeTask(task)).propagation;
  }

  async function ensureCurrentProfilePropagated(
    subjectId: string,
    profile: RecommendationProfileSnapshot,
    reason: RecommendationDerivedStateInvalidationReason,
    occurredAt: string
  ): Promise<RecommendationDerivedStatePropagationResult> {
    const digest = semanticProfileDigest(profile);
    const checkpoint = await checkpointStore.load(subjectId);
    if (checkpoint !== undefined && validateDigest(checkpoint) === digest) {
      return propagation(false, digest, []);
    }
    const task = freezeTask({
      subjectId,
      reason,
      profileDigest: digest,
      occurredAt,
      phase: "derived_invalidation_pending",
      pendingTargets: RECOMMENDATION_DERIVED_STATE_TARGETS
    });
    await taskStore.save(task);
    return (await resumeTask(task)).propagation;
  }

  return Object.freeze({
    async process(input: RecommendationEngineProcessInput) {
      return runSerialized(input.subjectId, async () => {
        await recoverPending(input.subjectId);
        const engine = await options.engine.process(input);
        const result = await ensureCurrentProfilePropagated(
          input.subjectId,
          engine.application.profile,
          processReason(input),
          validateTimestamp(input.now ?? nowProvider())
        );
        return Object.freeze({ engine, propagation: result });
      });
    },

    async synchronize(input: RecommendationEngineSynchronizeInput) {
      return runSerialized(input.subjectId, async () => {
        await recoverPending(input.subjectId);
        const application = await options.engine.synchronize(input);
        const result = await ensureCurrentProfilePropagated(
          input.subjectId,
          application.profile,
          "signal_expired",
          validateTimestamp(input.now ?? nowProvider())
        );
        return Object.freeze({ application, propagation: result });
      });
    },

    async repair(rawSubjectId: string) {
      return runSerialized(rawSubjectId, async () => {
        const subjectId = validateSubjectId(rawSubjectId);
        const pending = await recoverPending(subjectId);
        if (pending !== undefined) {
          return pending;
        }
        const profile = await options.engine.readProfile(subjectId);
        return ensureCurrentProfilePropagated(
          subjectId,
          profile,
          "profile_changed",
          validateTimestamp(nowProvider())
        );
      });
    },

    async deleteSubject(intent: RecommendationDerivedDataDeletionIntent) {
      return runSerialized(intent.subjectId, async () => {
        await recoverPending(intent.subjectId);
        const profile = await options.engine.readProfile(intent.subjectId);
        const task = freezeTask({
          subjectId: intent.subjectId,
          reason: "deletion_requested",
          profileDigest: semanticProfileDigest(profile),
          occurredAt: validateTimestamp(intent.requestedAt),
          phase: "engine_deletion_pending",
          deletionIntent: intent,
          pendingTargets: []
        });
        await taskStore.save(task);
        const resumed = await resumeTask(task);
        if (resumed.engineDeletion === undefined) {
          throw new Error("Recommendation deletion recovery did not execute the authoritative deletion.");
        }
        return Object.freeze({
          engine: resumed.engineDeletion,
          propagation: resumed.propagation
        });
      });
    }
  });
}