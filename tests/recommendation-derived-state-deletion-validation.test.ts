import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationDerivedStateInvalidationOrchestrator,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateInvalidationTaskStore
} from "../src/recommendation/derived-state-invalidation-orchestrator.js";

const NOW = "2026-08-06T00:00:00Z";
const EMPTY_PROFILE = Object.freeze({
  schemaVersion: "recommendation-profile.v1" as const,
  updatedAt: NOW,
  signalCount: 0,
  entries: Object.freeze([])
});

function invalidators() {
  return {
    embeddings: { async invalidate() {} },
    candidate_cache: { async invalidate() {} },
    explanation_cache: { async invalidate() {} }
  } as const;
}

function engine(deletedSubjects: string[]) {
  return {
    async process() { throw new Error("unused"); },
    async synchronize() { throw new Error("unused"); },
    async readProfile() { return EMPTY_PROFILE; },
    async deleteSubject(intent: { subjectId: string }) {
      deletedSubjects.push(intent.subjectId);
      return {
        subjectId: intent.subjectId,
        profile: EMPTY_PROFILE,
        ledgerCleared: true as const,
        replayBarrierInstalled: true as const
      };
    }
  };
}

test("derived-state deletion rejects malformed scopes instead of normalizing them", async () => {
  const deletedSubjects: string[] = [];
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine(deletedSubjects),
    invalidators: invalidators(),
    now: () => NOW
  });

  await assert.rejects(
    orchestrator.deleteSubject({
      subjectId: "alice",
      requestedAt: NOW,
      scope: "wrong_scope",
      targets: ["profile", "event_history"]
    } as never),
    /deletion intent scope/u
  );
  assert.deepEqual(deletedSubjects, []);
});

test("repair rejects recovered deletion tasks whose intent subject differs from the task subject", async () => {
  const deletedSubjects: string[] = [];
  const corruptedTask: RecommendationDerivedStateInvalidationTask = {
    subjectId: "alice",
    reason: "deletion_requested",
    profileDigest: "0".repeat(64),
    occurredAt: NOW,
    phase: "engine_deletion_pending",
    deletionIntent: {
      subjectId: "bob",
      requestedAt: NOW,
      scope: "recommendation_derived_data",
      targets: ["profile", "event_history"]
    },
    pendingTargets: []
  };
  const taskStore: RecommendationDerivedStateInvalidationTaskStore = {
    async load(subjectId) {
      return subjectId === "alice" ? corruptedTask : undefined;
    },
    async save() {},
    async delete() {}
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine(deletedSubjects),
    invalidators: invalidators(),
    taskStore,
    now: () => NOW
  });

  await assert.rejects(orchestrator.repair("alice"), /task subject mismatch/u);
  assert.deepEqual(deletedSubjects, []);
});

test("repair rejects a self-consistent deletion task stored under another subject key", async () => {
  const deletedSubjects: string[] = [];
  const swappedTask: RecommendationDerivedStateInvalidationTask = {
    subjectId: "bob",
    reason: "deletion_requested",
    profileDigest: "0".repeat(64),
    occurredAt: NOW,
    phase: "engine_deletion_pending",
    deletionIntent: {
      subjectId: "bob",
      requestedAt: NOW,
      scope: "recommendation_derived_data",
      targets: ["profile", "event_history"]
    },
    pendingTargets: []
  };
  const taskStore: RecommendationDerivedStateInvalidationTaskStore = {
    async load(subjectId) {
      return subjectId === "alice" ? swappedTask : undefined;
    },
    async save() {},
    async delete() {}
  };
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine: engine(deletedSubjects),
    invalidators: invalidators(),
    taskStore,
    now: () => NOW
  });

  await assert.rejects(orchestrator.repair("alice"), /recovered task subject mismatch/u);
  assert.deepEqual(deletedSubjects, []);
});
