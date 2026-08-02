import test from "node:test";
import assert from "node:assert/strict";

import type { RecommendationDerivedDataDeletionIntent } from "../src/recommendation/consent.js";
import { createRecommendationEngineOrchestrator } from "../src/recommendation/engine-orchestrator.js";
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

test("recommendation engine processes ledger events into a profile without retry double counting", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });

  const first = await engine.process({ subjectId: "alice", events: [apply()] });
  const retry = await engine.process({ subjectId: "alice", events: [apply()] });

  assert.equal(first.ingestion.appliedCount, 1);
  assert.equal(first.application.profile.signalCount, 1);
  assert.equal(retry.ingestion.duplicateCount, 1);
  assert.equal(retry.application.profile.signalCount, 1);
  assert.equal(retry.application.profile.entries[0]?.score, 0.5);
});

test("recommendation engine removes a retracted contribution from the derived profile", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });

  await engine.process({ subjectId: "alice", events: [apply()] });
  const result = await engine.process({ subjectId: "alice", events: [retract()] });

  assert.equal(result.ingestion.retractedCount, 1);
  assert.equal(result.application.activeSignalCount, 0);
  assert.equal(result.application.tombstoneCount, 1);
  assert.equal(result.application.profile.signalCount, 0);
  assert.deepEqual(result.application.profile.entries, []);
});

test("recommendation engine retains authoritative ledger state when profile application fails and repairs on synchronize", async () => {
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
  const engine = createRecommendationEngineOrchestrator({ profileStore: failingStore, now: () => NOW });

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

test("recommendation engine isolates subjects", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });

  await Promise.all([
    engine.process({ subjectId: "alice", events: [apply("alice-apply", "alice-source")] }),
    engine.process({ subjectId: "bob", events: [apply("bob-apply", "bob-source")] })
  ]);

  assert.equal((await engine.readProfile("alice")).signalCount, 1);
  assert.equal((await engine.readProfile("bob")).signalCount, 1);
  assert.equal((await engine.readLedgerSnapshot({ subjectId: "alice", now: NOW })).operationCount, 1);
  assert.equal((await engine.readLedgerSnapshot({ subjectId: "bob", now: NOW })).operationCount, 1);
});

test("recommendation engine deletion clears profile and event history without resurrection", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });
  await engine.process({ subjectId: "alice", events: [apply()] });

  const result = await engine.deleteSubject(deletion("alice"));
  assert.equal(result.ledgerCleared, true);
  assert.equal(result.profile.signalCount, 0);
  assert.equal((await engine.readProfile("alice")).signalCount, 0);
  assert.equal((await engine.readLedgerSnapshot({ subjectId: "alice", now: NOW })).operationCount, 0);

  const synchronized = await engine.synchronize({ subjectId: "alice", now: NOW });
  assert.equal(synchronized.profile.signalCount, 0);
});

test("recommendation engine requires deletion of profile and event history together", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW
  });

  await assert.rejects(
    engine.deleteSubject({ ...deletion("alice"), targets: ["profile"] }),
    /must include profile and event history/u
  );
});

test("recommendation engine rejects malformed input and oversized batches", async () => {
  const engine = createRecommendationEngineOrchestrator({
    profileStore: createInMemoryRecommendationProfileSignalReplacementStore(),
    now: () => NOW,
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
