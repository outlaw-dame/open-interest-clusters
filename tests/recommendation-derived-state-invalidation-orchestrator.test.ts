import test from "node:test";
import assert from "node:assert/strict";

import {
  RecommendationDerivedStateInvalidationPendingError,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createInMemoryRecommendationProfileSignalReplacementStore,
  normalizeRecommendationInterestSignal,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateInvalidationTaskStore,
  type RecommendationDerivedStateTarget,
  type RecommendationSignalLedgerEventInput
} from "../src/index.js";

const NOW = "2026-08-05T22:00:00.000Z";
const SIGNAL = normalizeRecommendationInterestSignal({
  target: { kind: "canonical_interest", key: "technology.local-first" },
  action: "select",
  polarity: "positive",
  strength: 0.8,
  confidence: 1,
  dataUse: "local_personalization",
  privacyBoundary: "local_only",
  evidence: {
    sourceItemKind: "collection",
    protocol: "app_local",
    sourceVisibility: "local_only",
    accessBasis: "owner",
    trustBoundary: "user_owned",
    observedAt: NOW
  },
  consent: {
    decision: "allow",
    reason: "consent.allow.explicit",
    dataUse: "local_personalization",
    protocol: "app_local",
    sourceVisibility: "local_only",
    accessBasis: "owner",
    containsPrivateData: true,
    containsThirdPartyData: false,
    serverSideProcessing: false
  }
});

function apply(): RecommendationSignalLedgerEventInput {
  return {
    operation: "apply",
    operationId: "apply-1",
    sourceEventId: "source-1",
    occurredAt: NOW,
    signal: SIGNAL
  };
}

function retract(): RecommendationSignalLedgerEventInput {
  return {
    operation: "retract",
    operationId: "retract-1",
    sourceEventId: "retract-event-1",
    retractsSourceEventId: "source-1",
    occurredAt: "2026-08-05T22:01:00.000Z",
    reason: "source_deleted"
  };
}

function harness(failOnce?: RecommendationDerivedStateTarget) {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    allowEmptySubjectInitialization: true,
    now: () => NOW
  });
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  let failed = false;
  const taskMap = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const taskStore: RecommendationDerivedStateInvalidationTaskStore = {
    async load(subjectId) { return taskMap.get(subjectId); },
    async save(task) { taskMap.set(task.subjectId, task); },
    async delete(subjectId) { taskMap.delete(subjectId); }
  };
  const invalidator = (target: RecommendationDerivedStateTarget) => ({
    async invalidate(request: RecommendationDerivedStateInvalidationRequest) {
      calls.push(request);
      if (target === failOnce && !failed) {
        failed = true;
        throw new Error("injected invalidation failure");
      }
    }
  });
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine,
    taskStore,
    now: () => NOW,
    invalidators: {
      embeddings: invalidator("embeddings"),
      candidate_cache: invalidator("candidate_cache"),
      explanation_cache: invalidator("explanation_cache")
    }
  });
  return { engine, orchestrator, calls, taskMap };
}

test("profile changes invalidate embeddings, candidates, and explanations in deterministic order", async () => {
  const { orchestrator, calls, taskMap } = harness();
  const result = await orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW });

  assert.equal(result.propagation.changed, true);
  assert.equal(result.propagation.reason, "profile_changed");
  assert.deepEqual(calls.map((call) => call.target), ["embeddings", "candidate_cache", "explanation_cache"]);
  assert.equal(new Set(calls.map((call) => call.profileDigest)).size, 1);
  assert.equal(taskMap.size, 0);
});

test("accepted retractions propagate with the signal-retracted reason", async () => {
  const { orchestrator, calls } = harness();
  await orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW });
  calls.length = 0;

  const result = await orchestrator.process({
    subjectId: "alice",
    events: [retract()],
    now: "2026-08-05T22:01:00.000Z"
  });

  assert.equal(result.engine.application.profile.signalCount, 0);
  assert.equal(result.propagation.reason, "signal_retracted");
  assert.ok(calls.every((call) => call.reason === "signal_retracted"));
});

test("duplicate replay with an unchanged profile does not invalidate derived state", async () => {
  const { orchestrator, calls } = harness();
  await orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW });
  calls.length = 0;

  const retry = await orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW });
  assert.equal(retry.engine.ingestion.duplicateCount, 1);
  assert.equal(retry.propagation.changed, false);
  assert.deepEqual(calls, []);
});

test("partial invalidation is journaled and repair resumes only unfinished targets", async () => {
  const { orchestrator, calls, taskMap } = harness("candidate_cache");

  await assert.rejects(
    orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW }),
    (error: unknown) => error instanceof RecommendationDerivedStateInvalidationPendingError &&
      error.pendingTargets.join(",") === "candidate_cache,explanation_cache"
  );
  assert.deepEqual(calls.map((call) => call.target), ["embeddings", "candidate_cache"]);
  assert.deepEqual(taskMap.get("alice")?.pendingTargets, ["candidate_cache", "explanation_cache"]);

  calls.length = 0;
  const repaired = await orchestrator.repair("alice");
  assert.equal(repaired.changed, true);
  assert.deepEqual(calls.map((call) => call.target), ["candidate_cache", "explanation_cache"]);
  assert.equal(taskMap.size, 0);
});

test("subject deletion installs the engine barrier and invalidates every dependent artifact", async () => {
  const { orchestrator, calls } = harness();
  await orchestrator.process({ subjectId: "alice", events: [apply()], now: NOW });
  calls.length = 0;

  const result = await orchestrator.deleteSubject({
    subjectId: "alice",
    requestedAt: "2026-08-05T22:05:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["profile", "event_history"]
  });

  assert.equal(result.engine.replayBarrierInstalled, true);
  assert.equal(result.propagation.reason, "deletion_requested");
  assert.deepEqual(calls.map((call) => call.target), ["embeddings", "candidate_cache", "explanation_cache"]);
});
