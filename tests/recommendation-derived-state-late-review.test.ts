import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationDerivedStateInvalidationOrchestrator,
  type RecommendationDerivedStateCheckpointStore,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateInvalidationTaskStore
} from "../src/recommendation/derived-state-invalidation-orchestrator.js";
import type { RecommendationProfileSnapshot } from "../src/recommendation/profile-store.js";

const NOW = "2026-08-06T02:30:00Z";

function profile(updatedAt: string, withEntry = true): RecommendationProfileSnapshot {
  return Object.freeze({
    schemaVersion: "recommendation-profile.v1",
    updatedAt,
    signalCount: withEntry ? 1 : 0,
    entries: withEntry
      ? Object.freeze([Object.freeze({
          target: Object.freeze({ kind: "canonical_interest" as const, key: "technology" }),
          score: 0.7,
          confidence: 0.8,
          signalCount: 1,
          positiveSignalCount: 1,
          negativeSignalCount: 0,
          neutralSignalCount: 0,
          privacyBoundaries: Object.freeze(["local_only" as const]),
          protocols: Object.freeze(["app_local" as const]),
          sourceVisibilities: Object.freeze(["local_only" as const]),
          updatedAt,
          expiresAt: "2026-08-06T02:29:00Z"
        })])
      : Object.freeze([])
  });
}

function stores(failFirstTaskSave = false): {
  taskStore: RecommendationDerivedStateInvalidationTaskStore;
  checkpointStore: RecommendationDerivedStateCheckpointStore;
  tasks: Map<string, RecommendationDerivedStateInvalidationTask>;
  checkpoints: Map<string, string>;
} {
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const checkpoints = new Map<string, string>();
  let shouldFail = failFirstTaskSave;
  return {
    tasks,
    checkpoints,
    taskStore: {
      async load(subjectId) { return tasks.get(subjectId); },
      async save(task) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("injected task save failure");
        }
        tasks.set(task.subjectId, task);
      },
      async delete(subjectId) { tasks.delete(subjectId); }
    },
    checkpointStore: {
      async load(subjectId) { return checkpoints.get(subjectId); },
      async save(subjectId, digest) { checkpoints.set(subjectId, digest); },
      async delete(subjectId) { checkpoints.delete(subjectId); }
    }
  };
}

function invalidators(calls: RecommendationDerivedStateInvalidationRequest[]) {
  const make = () => ({
    async invalidate(request: RecommendationDerivedStateInvalidationRequest) {
      calls.push(request);
    }
  });
  return {
    embeddings: make(),
    candidate_cache: make(),
    explanation_cache: make()
  } as const;
}

test("repair reconstructs missing invalidation work after post-profile journal failure", async () => {
  const state = stores(true);
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  let current = profile("2026-08-06T02:00:00Z", false);
  const engine = {
    async readProfile() { return current; },
    async process() {
      current = profile(NOW, true);
      return {
        subjectId: "alice",
        ingestion: {},
        application: { subjectId: "alice", activeSignalCount: 1, profile: current }
      } as any;
    },
    async synchronize() { return { subjectId: "alice", activeSignalCount: 1, profile: current } as any; },
    async deleteSubject() { throw new Error("not used"); }
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine as any,
    invalidators: invalidators(calls),
    taskStore: state.taskStore,
    checkpointStore: state.checkpointStore,
    now: () => NOW
  });

  await assert.rejects(
    orchestrator.process({ subjectId: "alice", events: [], now: NOW }),
    /injected task save failure/u
  );
  assert.equal(calls.length, 0);
  assert.equal(state.tasks.size, 0);

  const repaired = await orchestrator.repair("alice");
  assert.equal(repaired.changed, true);
  assert.deepEqual(calls.map((call) => call.target), [
    "embeddings",
    "candidate_cache",
    "explanation_cache"
  ]);
  assert.equal(state.checkpoints.get("alice"), repaired.profileDigest);
});

test("repair resumes the authoritative deletion phase before derived invalidation", async () => {
  const state = stores();
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  let deleteCalls = 0;
  const current = profile(NOW, true);
  const engine = {
    async readProfile() { return current; },
    async process() { throw new Error("not used"); },
    async synchronize() { throw new Error("not used"); },
    async deleteSubject() {
      deleteCalls += 1;
      if (deleteCalls === 1) throw new Error("injected deletion failure");
      return {
        subjectId: "alice",
        profile: profile(NOW, false),
        ledgerCleared: true,
        replayBarrierInstalled: true
      } as any;
    }
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine as any,
    invalidators: invalidators(calls),
    taskStore: state.taskStore,
    checkpointStore: state.checkpointStore,
    now: () => NOW
  });
  const intent = {
    subjectId: "alice",
    requestedAt: NOW,
    scope: "recommendation_derived_data" as const,
    targets: ["profile", "event_history"] as const
  };

  await assert.rejects(orchestrator.deleteSubject(intent), /injected deletion failure/u);
  assert.equal(state.tasks.get("alice")?.phase, "engine_deletion_pending");
  assert.equal(calls.length, 0);

  const repaired = await orchestrator.repair("alice");
  assert.equal(deleteCalls, 2);
  assert.equal(repaired.reason, "deletion_requested");
  assert.equal(state.tasks.size, 0);
  assert.equal(state.checkpoints.size, 0);
  assert.equal(calls.length, 3);
});

test("synchronization ignores timestamp-only profile replacement", async () => {
  const state = stores();
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  let current = profile("2026-08-06T02:00:00Z", true);
  const engine = {
    async readProfile() { return current; },
    async process() {
      return {
        subjectId: "alice",
        ingestion: {},
        application: { subjectId: "alice", activeSignalCount: 1, profile: current }
      } as any;
    },
    async synchronize() {
      current = profile("2026-08-06T02:20:00Z", true);
      return { subjectId: "alice", activeSignalCount: 1, profile: current } as any;
    },
    async deleteSubject() { throw new Error("not used"); }
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine as any,
    invalidators: invalidators(calls),
    taskStore: state.taskStore,
    checkpointStore: state.checkpointStore,
    now: () => NOW
  });

  await orchestrator.process({ subjectId: "alice", events: [], now: NOW });
  calls.length = 0;
  const synchronized = await orchestrator.synchronize({ subjectId: "alice", now: NOW });
  assert.equal(synchronized.propagation.changed, false);
  assert.equal(calls.length, 0);
});

test("synchronization detects expiration from the propagated checkpoint", async () => {
  const state = stores();
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  let current = profile("2026-08-06T02:00:00Z", true);
  const engine = {
    async readProfile() {
      current = profile(NOW, false);
      return current;
    },
    async process() {
      current = profile("2026-08-06T02:00:00Z", true);
      return {
        subjectId: "alice",
        ingestion: {},
        application: { subjectId: "alice", activeSignalCount: 1, profile: current }
      } as any;
    },
    async synchronize() {
      current = profile(NOW, false);
      return { subjectId: "alice", activeSignalCount: 0, profile: current } as any;
    },
    async deleteSubject() { throw new Error("not used"); }
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine as any,
    invalidators: invalidators(calls),
    taskStore: state.taskStore,
    checkpointStore: state.checkpointStore,
    now: () => NOW
  });

  await orchestrator.process({ subjectId: "alice", events: [], now: "2026-08-06T02:00:00Z" });
  calls.length = 0;
  const synchronized = await orchestrator.synchronize({ subjectId: "alice", now: NOW });
  assert.equal(synchronized.propagation.changed, true);
  assert.equal(synchronized.propagation.reason, "signal_expired");
  assert.equal(calls.length, 3);
});
