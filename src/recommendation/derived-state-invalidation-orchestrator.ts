import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import { createRecommendationEmbeddingSourceFingerprint } from "./embedding-lifecycle.js";
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
}

export interface RecommendationDerivedStateInvalidationTaskStore {
  load(subjectId: string): Promise<RecommendationDerivedStateInvalidationTask | undefined>;
  save(task: RecommendationDerivedStateInvalidationTask): Promise<void>;
  delete(subjectId: string): Promise<void>;
}

export interface RecommendationDerivedStateInvalidationOrchestratorOptions {
  engine: Pick<
    RecommendationEngineOrchestrator,
    "process" | "synchronize" | "readProfile" | "deleteSubject"
  >;
  invalidators: Readonly<Record<RecommendationDerivedStateTarget, RecommendationDerivedStateInvalidator>>;
  taskStore?: RecommendationDerivedStateInvalidationTaskStore;
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
const MAX_SUBJECT_ID_LENGTH = 512;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSubjectId(value: unknown): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > MAX_SUBJECT_ID_LENGTH || hasUnsafeControlCharacter(value)
  ) throw new TypeError("Invalid recommendation derived-state subject ID.");
  return value;
}

function validateTimestamp(value: unknown): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) throw new TypeError("Invalid recommendation derived-state timestamp.");
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

function freezeTask(task: RecommendationDerivedStateInvalidationTask): RecommendationDerivedStateInvalidationTask {
  const targets = task.pendingTargets.map(validateTarget);
  if (new Set(targets).size !== targets.length) {
    throw new TypeError("Duplicate recommendation derived-state pending target.");
  }
  return Object.freeze({
    subjectId: validateSubjectId(task.subjectId),
    reason: validateReason(task.reason),
    profileDigest: validateDigest(task.profileDigest),
    occurredAt: validateTimestamp(task.occurredAt),
    pendingTargets: Object.freeze(targets)
  });
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

function profileDigest(profile: RecommendationProfileSnapshot): string {
  return createRecommendationEmbeddingSourceFingerprint(profile).profileDigest;
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
  if (!isPlainRecord(taskStore) || typeof taskStore.load !== "function" ||
      typeof taskStore.save !== "function" || typeof taskStore.delete !== "function") {
    throw new TypeError("Invalid recommendation derived-state task store.");
  }
  const nowProvider = options.now ?? (() => new Date().toISOString());
  if (typeof nowProvider !== "function") throw new TypeError("Invalid recommendation derived-state clock.");
  const tails = new Map<string, Promise<void>>();

  async function runSerialized<T>(subjectId: string, work: () => Promise<T>): Promise<T> {
    const id = validateSubjectId(subjectId);
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

  async function drain(taskInput: RecommendationDerivedStateInvalidationTask): Promise<RecommendationDerivedStatePropagationResult> {
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
      task = freezeTask({ ...task, pendingTargets: task.pendingTargets.filter((item) => item !== target) });
      if (task.pendingTargets.length > 0) await taskStore.save(task);
    }
    await taskStore.delete(task.subjectId);
    return propagation(true, task.profileDigest, completed, task.reason);
  }

  async function schedule(
    subjectId: string,
    profile: RecommendationProfileSnapshot,
    reason: RecommendationDerivedStateInvalidationReason,
    occurredAt: string
  ): Promise<RecommendationDerivedStatePropagationResult> {
    const task = freezeTask({
      subjectId,
      reason,
      profileDigest: profileDigest(profile),
      occurredAt,
      pendingTargets: RECOMMENDATION_DERIVED_STATE_TARGETS
    });
    await taskStore.save(task);
    return drain(task);
  }

  return Object.freeze({
    async process(input: RecommendationEngineProcessInput) {
      return runSerialized(input.subjectId, async () => {
        const before = await options.engine.readProfile(input.subjectId);
        const beforeDigest = profileDigest(before);
        const engine = await options.engine.process(input);
        const after = engine.application.profile;
        const afterDigest = profileDigest(after);
        if (beforeDigest === afterDigest) {
          return Object.freeze({ engine, propagation: propagation(false, afterDigest, []) });
        }
        const result = await schedule(
          input.subjectId,
          after,
          processReason(input),
          validateTimestamp(input.now ?? nowProvider())
        );
        return Object.freeze({ engine, propagation: result });
      });
    },

    async synchronize(input: RecommendationEngineSynchronizeInput) {
      return runSerialized(input.subjectId, async () => {
        const before = await options.engine.readProfile(input.subjectId);
        const beforeDigest = profileDigest(before);
        const application = await options.engine.synchronize(input);
        const afterDigest = profileDigest(application.profile);
        if (beforeDigest === afterDigest) {
          return Object.freeze({ application, propagation: propagation(false, afterDigest, []) });
        }
        const result = await schedule(
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
        const task = await taskStore.load(subjectId);
        if (task === undefined) {
          const profile = await options.engine.readProfile(subjectId);
          return propagation(false, profileDigest(profile), []);
        }
        return drain(task);
      });
    },

    async deleteSubject(intent: RecommendationDerivedDataDeletionIntent) {
      return runSerialized(intent.subjectId, async () => {
        const occurredAt = validateTimestamp(intent.requestedAt);
        const before = await options.engine.readProfile(intent.subjectId);
        const task = freezeTask({
          subjectId: intent.subjectId,
          reason: "deletion_requested",
          profileDigest: profileDigest(before),
          occurredAt,
          pendingTargets: RECOMMENDATION_DERIVED_STATE_TARGETS
        });
        await taskStore.save(task);
        const engine = await options.engine.deleteSubject(intent);
        const result = await drain(task);
        return Object.freeze({ engine, propagation: result });
      });
    }
  });
}
