import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRecommendationInterestSignal } from "../src/recommendation/interest-signal.js";
import { createRecommendationProfileApplicationOrchestrator } from "../src/recommendation/profile-application-orchestrator.js";
import { createInMemoryRecommendationProfileSignalReplacementStore } from "../src/recommendation/profile-replacement-store.js";
import { createInMemoryRecommendationSignalLedger } from "../src/recommendation/signal-ledger.js";

const SUBJECT = "did:plc:profile-user";
const NOW = "2026-08-01T23:00:00Z";

function signal(key: string, polarity: "positive" | "negative" = "positive") {
  return normalizeRecommendationInterestSignal({
    target: { kind: "canonical_interest", key },
    action: "label",
    polarity,
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
      observedAt: "2026-08-01T22:00:00Z"
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
}

function apply(operationId: string, sourceEventId: string, interest: string) {
  return {
    operation: "apply" as const,
    operationId,
    sourceEventId,
    occurredAt: "2026-08-01T22:00:00Z",
    signal: signal(interest)
  };
}

test("profile application replaces from active ledger state without double counting retries", async () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply("apply-1", "source-1", "sports.nba"));
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  const orchestrator = createRecommendationProfileApplicationOrchestrator({ profileStore: store, now: () => NOW });

  const first = await orchestrator.synchronize({ subjectId: SUBJECT, ledger });
  const second = await orchestrator.synchronize({ subjectId: SUBJECT, ledger });

  assert.equal(first.profile.signalCount, 1);
  assert.equal(second.profile.signalCount, 1);
  assert.equal(second.profile.entries[0]?.score, 0.5);
  assert.equal(second.acceptedSignalCount, 1);
});

test("profile application removes retracted contributions on the next synchronization", async () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply("apply-1", "source-1", "sports.nba"));
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  const orchestrator = createRecommendationProfileApplicationOrchestrator({ profileStore: store, now: () => NOW });

  await orchestrator.synchronize({ subjectId: SUBJECT, ledger });
  ledger.ingest({
    operation: "retract",
    operationId: "retract-1",
    sourceEventId: "retraction-event-1",
    retractsSourceEventId: "source-1",
    occurredAt: "2026-08-01T22:30:00Z",
    reason: "label_negated"
  });
  const result = await orchestrator.synchronize({ subjectId: SUBJECT, ledger });

  assert.equal(result.activeSignalCount, 0);
  assert.equal(result.tombstoneCount, 1);
  assert.equal(result.profile.signalCount, 0);
  assert.deepEqual(result.profile.entries, []);
});

test("replacement store preserves the prior subject profile when replacement validation fails", async () => {
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  await store.ingestSignals({ subjectId: SUBJECT, signals: [signal("sports.nba")], now: NOW });

  await assert.rejects(
    store.replaceSignals({ subjectId: SUBJECT, signals: [{ invalid: true } as never], now: NOW }),
    /Invalid recommendation profile interest signal/u
  );

  const profile = await store.readProfile(SUBJECT);
  assert.equal(profile.signalCount, 1);
  assert.equal(profile.entries[0]?.target.key, "sports.nba");
});

test("replacement store isolates subjects during atomic replacement", async () => {
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  await store.replaceSignals({ subjectId: "did:plc:one", signals: [signal("sports.nba")], now: NOW });
  await store.replaceSignals({ subjectId: "did:plc:two", signals: [signal("technology.ai")], now: NOW });
  await store.replaceSignals({ subjectId: "did:plc:one", signals: [], now: NOW });

  assert.equal((await store.readProfile("did:plc:one")).signalCount, 0);
  assert.equal((await store.readProfile("did:plc:two")).entries[0]?.target.key, "technology.ai");
});

test("profile application reports ledger metadata without exposing source-event keys", async () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply("apply-1", "sensitive-provider-event", "sports.nba"));
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  const orchestrator = createRecommendationProfileApplicationOrchestrator({ profileStore: store, now: () => NOW });

  const result = await orchestrator.synchronize({ subjectId: SUBJECT, ledger });
  assert.equal(result.ledgerOperationCount, 1);
  assert.equal(JSON.stringify(result).includes("sensitive-provider-event"), false);
});

test("profile application rejects malformed subjects and timestamps before replacement", async () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  const store = createInMemoryRecommendationProfileSignalReplacementStore();
  const orchestrator = createRecommendationProfileApplicationOrchestrator({ profileStore: store });

  await assert.rejects(
    orchestrator.synchronize({ subjectId: " bad ", ledger, now: NOW }),
    /Invalid recommendation profile application subject ID/u
  );
  await assert.rejects(
    orchestrator.synchronize({ subjectId: SUBJECT, ledger, now: "not-a-time" }),
    /Invalid recommendation profile application timestamp/u
  );
});
