import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationDerivedStateInvalidationPendingError,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  normalizeRecommendationInterestSignal,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateTarget,
  type RecommendationSignalLedgerEventInput
} from "../src/index.js";

const NOW = "2026-10-01T10:00:00.000Z";
const SIGNAL = normalizeRecommendationInterestSignal({
  target: { kind: "canonical_interest", key: "technology.local-first" },
  action: "select", polarity: "positive", strength: 0.8, confidence: 1,
  dataUse: "local_personalization", privacyBoundary: "local_only",
  evidence: { sourceItemKind: "collection", protocol: "app_local", sourceVisibility: "local_only", accessBasis: "owner", trustBoundary: "user_owned", observedAt: NOW },
  consent: { decision: "allow", reason: "consent.allow.explicit", dataUse: "local_personalization", protocol: "app_local", sourceVisibility: "local_only", accessBasis: "owner", containsPrivateData: true, containsThirdPartyData: false, serverSideProcessing: false }
});
const APPLY: RecommendationSignalLedgerEventInput = { operation: "apply", operationId: "op-1", sourceEventId: "src-1", occurredAt: NOW, signal: SIGNAL };

function harness(failures: RecommendationDerivedStateTarget[] = []) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => NOW });
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const invalidator = (target: RecommendationDerivedStateTarget) => ({
    async invalidate(request: RecommendationDerivedStateInvalidationRequest) {
      calls.push(request);
      const index = failures.indexOf(target);
      if (index >= 0) { failures.splice(index, 1); throw new Error("injected"); }
    }
  });
  const orchestrator = createRecommendationDerivedStateInvalidationOrchestrator({
    engine,
    taskStore: { async load(id) { return tasks.get(id); }, async save(task) { tasks.set(task.subjectId, task); }, async delete(id) { tasks.delete(id); } },
    now: () => NOW,
    invalidators: { embeddings: invalidator("embeddings"), candidate_cache: invalidator("candidate_cache"), explanation_cache: invalidator("explanation_cache") }
  });
  return { engine, orchestrator, calls, tasks };
}

test("the engine exposes accepted event history oldest first, without duplicates, and honors the deletion barrier", async () => {
  const { engine, orchestrator } = harness();
  await orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW });
  await orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW });
  const history = await engine.readEventHistory("alice");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.sourceEventId, "src-1");
  await assert.rejects(engine.readEventHistory(" bad "), /subject ID/u);
  await orchestrator.deleteSubject({ subjectId: "alice", requestedAt: NOW, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
  await assert.rejects(engine.readEventHistory("alice"), /deletion replay barrier/u);
});

test("candidate-state invalidation clears only the candidate and explanation caches", async () => {
  const { orchestrator, calls, tasks } = harness();
  await orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW });
  calls.length = 0;
  const result = await orchestrator.invalidateCandidateState({ subjectId: "alice", occurredAt: "2026-10-01T11:00:00.000Z" });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "candidate_state_changed");
  assert.deepEqual(calls.map((call) => call.target), ["candidate_cache", "explanation_cache"]);
  assert.ok(calls.every((call) => call.reason === "candidate_state_changed" && call.occurredAt === "2026-10-01T11:00:00.000Z"));
  assert.equal(tasks.size, 0);
  // A profile-only repair afterwards finds nothing to do: the checkpoint still matches.
  calls.length = 0;
  assert.equal((await orchestrator.repair("alice")).changed, false);
  assert.deepEqual(calls, []);
});

test("candidate-state invalidation repeats on every report, since each report is a new fact", async () => {
  const { orchestrator, calls } = harness();
  await orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW });
  calls.length = 0;
  await orchestrator.invalidateCandidateState({ subjectId: "alice" });
  await orchestrator.invalidateCandidateState({ subjectId: "alice" });
  assert.equal(calls.length, 4);
});

test("a failed explanation-cache clear is journaled, reported as pending, and finished by repair", async () => {
  const failures: RecommendationDerivedStateTarget[] = [];
  const { orchestrator, calls, tasks } = harness(failures);
  await orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW });
  calls.length = 0;
  failures.push("explanation_cache");
  await assert.rejects(
    orchestrator.invalidateCandidateState({ subjectId: "alice" }),
    (error: unknown) => error instanceof RecommendationDerivedStateInvalidationPendingError && error.pendingTargets.join(",") === "explanation_cache"
  );
  const pending = tasks.get("alice");
  assert.equal(pending?.reason, "candidate_state_changed");
  assert.deepEqual(pending?.pendingTargets, ["explanation_cache"]);
  calls.length = 0;
  const repaired = await orchestrator.repair("alice");
  assert.equal(repaired.reason, "candidate_state_changed");
  assert.deepEqual(calls.map((call) => call.target), ["explanation_cache"]);
  assert.equal(tasks.size, 0);
});

test("a pending profile invalidation is finished before the candidate-state task runs", async () => {
  const { orchestrator, calls, tasks } = harness(["candidate_cache"]);
  await assert.rejects(orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW }), RecommendationDerivedStateInvalidationPendingError);
  assert.equal(tasks.get("alice")?.reason, "profile_changed");
  calls.length = 0;
  const result = await orchestrator.invalidateCandidateState({ subjectId: "alice" });
  // First the interrupted profile task (candidate + explanation), then the new candidate-state task.
  assert.deepEqual(calls.map((call) => `${call.reason}:${call.target}`), [
    "profile_changed:candidate_cache", "profile_changed:explanation_cache",
    "candidate_state_changed:candidate_cache", "candidate_state_changed:explanation_cache"
  ]);
  assert.equal(result.reason, "candidate_state_changed");
  assert.equal(tasks.size, 0);
});

test("candidate-state invalidation rejects bad input and serializes with other work for the subject", async () => {
  const { orchestrator } = harness();
  await assert.rejects(orchestrator.invalidateCandidateState(null as never), TypeError);
  await assert.rejects(orchestrator.invalidateCandidateState({ subjectId: " " }), TypeError);
  await assert.rejects(orchestrator.invalidateCandidateState({ subjectId: "alice", occurredAt: "soon" }), TypeError);
  const order: string[] = [];
  const slow = harness();
  await Promise.all([
    slow.orchestrator.process({ subjectId: "alice", events: [APPLY], now: NOW }).then(() => order.push("process")),
    slow.orchestrator.invalidateCandidateState({ subjectId: "alice" }).then(() => order.push("candidate"))
  ]);
  assert.deepEqual(order, ["process", "candidate"]);
  assert.deepEqual(slow.calls.slice(-2).map((call) => call.target), ["candidate_cache", "explanation_cache"]);
});
