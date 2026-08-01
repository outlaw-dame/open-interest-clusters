import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRecommendationInterestSignal } from "../src/recommendation/interest-signal.js";
import { createInMemoryRecommendationSignalLedger } from "../src/recommendation/signal-ledger.js";

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
    trustBoundary: "external_provider",
    observedAt: "2026-08-01T20:00:00Z"
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

function apply(operationId = "apply-1", sourceEventId = "atproto-label-event-1") {
  return {
    operation: "apply" as const,
    operationId,
    sourceEventId,
    occurredAt: "2026-08-01T20:00:00Z",
    signal: SIGNAL
  };
}

function retract(operationId = "retract-1", target = "atproto-label-event-1") {
  return {
    operation: "retract" as const,
    operationId,
    sourceEventId: `${operationId}-source`,
    retractsSourceEventId: target,
    occurredAt: "2026-08-01T21:00:00Z",
    reason: "label_negated" as const
  };
}

test("signal ledger applies a signal once and exposes only hashed source references", () => {
  const ledger = createInMemoryRecommendationSignalLedger({ salt: "test-salt" });
  const result = ledger.ingest(apply());

  assert.equal(result.decision, "applied");
  assert.equal(result.activeSignalCount, 1);
  assert.match(result.operationKey, /^signal-operation:[a-f0-9]{64}$/u);
  assert.match(result.sourceEventKey, /^signal-source-event:[a-f0-9]{64}$/u);
  assert.equal(result.operationKey.includes("apply-1"), false);
  assert.equal(result.sourceEventKey.includes("atproto-label-event-1"), false);

  const snapshot = ledger.snapshot({ now: "2026-08-01T20:30:00Z" });
  assert.equal(snapshot.activeSignals.length, 1);
  assert.equal(snapshot.operationCount, 1);
  assert.equal(JSON.stringify(snapshot).includes("atproto-label-event-1"), false);
  assert.equal(snapshot.activeSignals[0]?.signal.target.key, "sports.nba");
});

test("signal ledger treats an exact operation retry as an idempotent duplicate", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  const first = ledger.ingest(apply());
  const duplicate = ledger.ingest(apply());

  assert.equal(first.decision, "applied");
  assert.equal(duplicate.decision, "duplicate");
  assert.equal(duplicate.operationKey, first.operationKey);
  assert.equal(duplicate.activeSignalCount, 1);
  assert.equal(ledger.snapshot().operationCount, 1);
});

test("signal ledger rejects reuse of an operation ID with different content", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply());

  assert.throws(
    () => ledger.ingest({ ...apply(), occurredAt: "2026-08-01T20:00:01Z" }),
    /Conflicting recommendation signal ledger operation ID/u
  );
});

test("signal ledger rejects two apply operations for the same source event", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply("apply-1", "source-1"));

  assert.throws(
    () => ledger.ingest(apply("apply-2", "source-1")),
    /Conflicting recommendation signal ledger source event ID/u
  );
});

test("signal ledger retracts an active signal and retains a tombstone", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply());
  const result = ledger.ingest(retract());

  assert.equal(result.decision, "retracted");
  assert.equal(result.activeSignalCount, 0);
  assert.equal(result.tombstoneCount, 1);

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.activeSignals.length, 0);
  assert.equal(snapshot.tombstones.length, 1);
  assert.equal(snapshot.tombstones[0]?.reason, "label_negated");
});

test("signal ledger preserves an out-of-order retraction and suppresses a late apply", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(retract("retract-before-apply", "late-source"));
  const result = ledger.ingest(apply("late-apply", "late-source"));

  assert.equal(result.decision, "suppressed_by_retraction");
  assert.equal(result.activeSignalCount, 0);
  assert.equal(result.tombstoneCount, 1);
  assert.equal(ledger.snapshot().operationCount, 2);
});

test("signal ledger makes retraction retries idempotent", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  const first = ledger.ingest(retract());
  const duplicate = ledger.ingest(retract());

  assert.equal(first.decision, "retracted");
  assert.equal(duplicate.decision, "duplicate");
  assert.equal(duplicate.tombstoneCount, 1);
});

test("signal ledger replaces an older tombstone only with an equal or newer retraction", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest({ ...retract("newer", "source-1"), occurredAt: "2026-08-01T22:00:00Z", reason: "source_deleted" });
  ledger.ingest({ ...retract("older", "source-1"), occurredAt: "2026-08-01T21:00:00Z", reason: "corrected" });

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.tombstones.length, 1);
  assert.equal(snapshot.tombstones[0]?.occurredAt, "2026-08-01T22:00:00Z");
  assert.equal(snapshot.tombstones[0]?.reason, "source_deleted");
});

test("signal ledger filters expired active signals without deleting replay state", () => {
  const expiringSignal = normalizeRecommendationInterestSignal({
    ...SIGNAL,
    expiresAt: "2026-08-02T00:00:00Z"
  });
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest({ ...apply(), signal: expiringSignal });

  assert.equal(ledger.listActiveSignals({ now: "2026-08-01T23:59:59Z" }).length, 1);
  assert.equal(ledger.listActiveSignals({ now: "2026-08-02T00:00:00Z" }).length, 0);
  assert.equal(ledger.snapshot({ now: "2026-08-02T00:00:00Z" }).operationCount, 1);
});

test("signal ledger batch reports applied, retracted, duplicate, and suppressed counts", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  const result = ledger.ingestBatch([
    apply("apply-a", "source-a"),
    apply("apply-a", "source-a"),
    retract("retract-b", "source-b"),
    apply("apply-b", "source-b"),
    retract("retract-a", "source-a")
  ]);

  assert.equal(result.appliedCount, 1);
  assert.equal(result.retractedCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.suppressedCount, 1);
  assert.equal(result.activeSignalCount, 0);
  assert.equal(result.tombstoneCount, 2);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.results), true);
});

test("signal ledger enforces its operation bound without evicting replay history", () => {
  const ledger = createInMemoryRecommendationSignalLedger({ maxOperations: 1 });
  ledger.ingest(apply());

  assert.throws(
    () => ledger.ingest(retract()),
    /Recommendation signal ledger operation limit exceeded/u
  );
});

test("signal ledger rejects malformed identifiers, timestamps, and reasons", () => {
  const ledger = createInMemoryRecommendationSignalLedger();

  assert.throws(
    () => ledger.ingest({ ...apply(), operationId: " bad " }),
    /Invalid recommendation signal ledger operation ID/u
  );
  assert.throws(
    () => ledger.ingest({ ...apply(), occurredAt: "not-a-time" }),
    /Invalid recommendation signal ledger timestamp/u
  );
  assert.throws(
    () => ledger.ingest({ ...retract(), reason: "unknown" as never }),
    /Invalid recommendation signal ledger retraction reason/u
  );
});

test("signal ledger clear removes active, tombstone, and replay state", () => {
  const ledger = createInMemoryRecommendationSignalLedger();
  ledger.ingest(apply());
  ledger.ingest(retract());
  ledger.clear();

  assert.deepEqual(ledger.snapshot(), {
    activeSignals: [],
    tombstones: [],
    operationCount: 0
  });
  assert.equal(ledger.ingest(apply()).decision, "applied");
});
