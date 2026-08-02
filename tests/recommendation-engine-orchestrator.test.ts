import test from "node:test";
import assert from "node:assert/strict";

import type { RecommendationDerivedDataDeletionIntent } from "../src/recommendation/consent.js";
import {
  createRecommendationEngineOrchestrator,
  type RecommendationEnginePersistedSubjectState,
  type RecommendationEngineSubjectStateStore
} from "../src/recommendation/engine-orchestrator.js";
import { normalizeRecommendationInterestSignal } from "../src/recommendation/interest-signal.js";
import {
  createInMemoryRecommendationProfileSignalReplacementStore,
  type RecommendationProfileSignalReplacementStore
} from "../src/recommendation/profile-replacement-store.js";
import type { RecommendationSignalLedgerEventInput } from "../src/recommendation/signal-ledger.js";

const NOW = "2026-08-02T00:00:00Z";

const SIGNAL = normalizeRecommendationInterestSignal({
  target: { kind: "canonical_interest", key: "sports.nba" },
  action: "label",
  polarity: "positive",
  strength: 0.5,
  confidence: 1,
  dataUse: "local_personalization",
  privacyBoundary: "local_only",
  evidence: {
    sourceItemKind: "label",
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo",
    trustBoundary: "remote_provider",
    observedAt: "2026-08-01T23:00:00Z"
  },
  consent: {
    decision: "allow",
    reason: "consent.allow.explicit",
    dataUse: "local_personalization",
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo",
    containsPrivateData: false,
    containsThirdPartyData: true,
    serverSideProcessing: false
  }
});

function apply(operationId = "apply-1", sourceEventId = "source-1"): RecommendationSignalLedgerEventInput {
  return {
    operation: "apply",
    operationId,
    sourceEventId,
    occurredAt: "2026-08-01T23:00:00Z",
    signal: SIGNAL
  };
}

function retract(operationId = "retract-1", target = "source-1"): RecommendationSignalLedgerEventInput {
  return {
    operation: "retract",
    operationId,
    sourceEventId: `${operationId}-event`,
    retractsSourceEventId: target,
    occurredAt: "2026-08-01T23:30:00Z",
    reason: "source_retracted"
  };
}

function deletion(subjectId: string): RecommendationDerivedDataDeletionIntent {
  return {
    subjectId,
    requestedAt: NOW,
    scope: "recommendation_derived_data",
    targets: ["profile", "event_history"]
  };
}

function engineOptions(profileStore = createInMemoryRecommendationProfileSignalReplacementStore()) {
  return {
    profileStore,
    now: () => NOW,
    allowEmptySubjectInitialization: true
  } as const;
}

function memoryStateStore(initial: ReadonlyMap<string, RecommendationEnginePersistedSubjectState> = new Map()): {
  store: RecommendationEngineSubjectStateStore;
  states: Map<string, RecommendationEnginePersistedSubjectState>;
} {
  const states = new Map(initial);
  return {
    states,
    store: {
      async load(subjectId) {
        return states.get(subjectId);
      },
      async save(subjectId, state) {
        states.set(subjectId, state);
      }
    }
  };
}

test("recommendation engine processes ledger events into a profile without retry double counting", async () => {
  const engine = createRecommendationEngineOrchestrator(engineOptions());

  const first = await engine.process({ subjectId: "alice", events: [apply()] });
  const retry = await engine.process({ subjectId: "alice", events: [apply()] });

  assert.equal(first.ingestion.appliedCount, 1);
  assert.equal(first.application.profile.signalCount, 1);
  assert.equal(retry.ingestion.duplicateCount, 1);
  assert.equal(retry.application.profile.signalCount, 1);
  assert.equal(retry.application.profile.entries[0]?.score, 0.5);
});

test("recommendation engine removes a retracted contribution from the derived profile", async () => {
  const engine = createRecommendationEngineOrchestrator(engineOptions());

  await engine.process({ subjectId: "alice", events: [apply()] });
  const result = await engine.process({ subjectId: "alice", events: [retract()] });

  assert.equal(result.ingestion.retractedCount, 1);
  assert.equal(result.application.activeSignalCount, 0);
  assert.equal(result.application.tombstoneCount, 1);
  assert.equal(result.application.profile.signalCount, 0);
  assert.deepEqual(result.application.profile.entries, []);
});

test("recommendation engine retains authoritative event history when profile application fails and repairs on synchronize", async () => {
  const backing = createInMemoryRecommendationProfileSignalReplacementStore();
  let failNextReplacement = true;
  const failingStore: RecommendationProfileSignalReplacementStore = {
    ...backing,
    async replaceSignals(input) {
      if (failNextReplacement) {
        failNextReplacement = false;
        throw new Error("injected replacement failure");
      }
      return backing.replaceSignals(input);
    }
  };
  const engine = createRecommendationEngineOrchestrator(engineOptions(failingStore));

  await assert.rejects(
    engine.process({ subjectId: "alice", events: [apply()] }),
    /injected replacement failure/u
  );

  const ledger = await engine.readLedgerSnapshot({ subjectId: "alice", now: NOW });
  assert.equal(ledger.operationCount, 1);
  assert.equal(ledger.activeSignals.length, 1);

  const repaired = await engine.synchronize({ subjectId: "alice", now: NOW });
  assert.equal(repaired.profile.signalCount, 1);
  assert.equal(repaired.acceptedSignalCount, 1);
});

test("recommendation engine validates a complete batch before changing authoritative state", async () => {
  const engine = createRecommendationEngineOrchestrator(engineOptions());
  const conflicting = { ...apply("apply-1", "source-2") };

  await assert.rejects(
    engine.process({ subjectId: "alice", events: [apply(), conflicting] }),
    /Conflicting recommendation signal ledger operation ID/u
  );

  const snapshot = await engine.readLedgerSnapshot({ subjectId: "alice", now: NOW });
  assert.equal(snapshot.operationCount, 0);
  assert.equal((await engine.readProfile("alice")).signalCount, 0);
});

test("recommendation engine restores event history before replacing an existing profile", async () => {
  const profileStore = createInMemoryRecommendationProfileSignalReplacementStore();
  await profileStore.replaceSignals({ subjectId: "alice", signals: [SIGNAL], now: NOW });
  const { store } = memoryStateStore(new Map([["alice", { events: [apply()] }]]));
  const engine = createRecommendationEngineOrchestrator({ profileStore, stateStore: store, now: () => NOW });

  const synchronized = await engine.synchronize({ subjectId: "alice", now: NOW });
  assert.equal(synchronized.profile.signalCount, 1);
  assert.equal(synchronized.ledgerOperationCount, 1);
});

test("recommendation engine fails closed when ledger recovery was not supplied", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });

  await assert.rejects(
    engine.synchronize({ subjectId: "alice", now: NOW }),
    /ledger recovery is required/u
  );
});

test("recommendation engine isolates subjects", async () => {
  const engine = createRecommendationEngineOrchestrator(engineOptions());

  await Promise.all([
    engine.process({ subjectId: "alice", events: [apply("alice-apply", "alice-source")] }),
    engine.process({ subjectId: "bob", events: [apply("bob-apply", "bob-source")] })
  ]);

  assert.equal((await engine.readProfile("alice")).signalCount, 1);
  assert.equal((await engine.readProfile("bob")).signalCount, 1);
});

test("recommendation engine deletion installs a replay barrier and prevents resurrection", async () => {
  const { store, states } = memoryStateStore();
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    stateStore: store,
    allowEmptySubjectInitialization: true,
    now: () => NOW
  });
  await engine.process({ subjectId: "alice", events: [apply()] });

  const result = await engine.deleteSubject(deletion("alice"));
  assert.equal(result.ledgerCleared, true);
  assert.equal(result.replayBarrierInstalled, true);
  assert.equal(result.profile.signalCount, 0);
  assert.equal(states.get("alice")?.deletedAt, NOW);
  assert.deepEqual(states.get("alice")?.events, []);

  await assert.rejects(
    engine.process({ subjectId: "alice", events: [apply()] }),
    /deletion replay barrier/u
  );
  await assert.rejects(
    engine.synchronize({ subjectId: "alice", now: NOW }),
    /deletion replay barrier/u
  );
  assert.equal((await engine.readProfile("alice")).signalCount, 0);
});

test("recommendation engine rejects unsupported and partial deletion targets", async () => {
  const engine = createRecommendationEngineOrchestrator(engineOptions());

  await assert.rejects(
    engine.deleteSubject({ ...deletion("alice"), targets: ["profile"] }),
    /supports exactly profile and event history/u
  );
  await assert.rejects(
    engine.deleteSubject({
      ...deletion("alice"),
      targets: ["profile", "event_history", "embeddings"]
    }),
    /supports exactly profile and event history/u
  );
});

test("recommendation engine rejects malformed input and oversized batches", async () => {
  const engine = createRecommendationEngineOrchestrator({
    ...engineOptions(),
    maxEventsPerBatch: 1
  });

  await assert.rejects(
    engine.process({ subjectId: " bad ", events: [] }),
    /Invalid recommendation engine subject ID/u
  );
  await assert.rejects(
    engine.process({ subjectId: "alice", events: [apply(), retract()] }),
    /event batch limit exceeded/u
  );
  await assert.rejects(
    engine.synchronize({ subjectId: "alice", now: "not-a-time" }),
    /Invalid recommendation engine timestamp/u
  );
});
