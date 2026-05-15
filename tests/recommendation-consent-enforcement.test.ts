import test from "node:test";
import assert from "node:assert/strict";

import {
  RecommendationConsentAuditError,
  RecommendationConsentDeniedError,
  RecommendationDerivedDataDeletionError,
  createRecommendationDerivedDataDeletionIntent,
  executeRecommendationDerivedDataDeletion,
  requireRecommendationConsent,
  withRecommendationConsent,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentAuditSink,
  type RecommendationConsentPolicy,
  type RecommendationConsentRequest,
  type RecommendationDerivedDataDeletionIntent
} from "../src/index.js";

const subjectId = "did:web:alice.example";
const policy: RecommendationConsentPolicy = {
  subjectId,
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"]
};
const request: RecommendationConsentRequest = {
  subjectId,
  dataUse: "ranking",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web"
};

function memoryAuditSink(events: PrivacySafeRecommendationConsentEvent[] = []): RecommendationConsentAuditSink {
  return {
    record(event) {
      events.push(event);
    }
  };
}

test("withRecommendationConsent runs an allowed operation exactly once", async () => {
  let calls = 0;
  const events: PrivacySafeRecommendationConsentEvent[] = [];

  const result = await withRecommendationConsent(
    policy,
    request,
    () => {
      calls += 1;
      return "ok";
    },
    { auditSink: memoryAuditSink(events) }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.decision, "allow");
  assert.equal(events[0]?.reason, "consent.allow.explicit");
});

test("withRecommendationConsent never runs a denied operation", async () => {
  let calls = 0;
  const events: PrivacySafeRecommendationConsentEvent[] = [];

  await assert.rejects(
    () => withRecommendationConsent(undefined, request, () => {
      calls += 1;
      return "should-not-run";
    }, { auditSink: memoryAuditSink(events) }),
    RecommendationConsentDeniedError
  );

  assert.equal(calls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.decision, "deny");
  assert.equal(events[0]?.reason, "consent.deny.default");
});

test("requireRecommendationConsent throws privacy-safe denial errors", async () => {
  let thrown: unknown;

  try {
    await requireRecommendationConsent(undefined, request);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof RecommendationConsentDeniedError);
  assert.equal(thrown.reason, "consent.deny.default");
  assert.equal(thrown.auditEvent.decision, "deny");
  assert.equal(thrown.message.includes(subjectId), false);
  assert.equal(JSON.stringify(thrown).includes(subjectId), false);
});

test("audit sink receives only privacy-safe event fields", async () => {
  const events: PrivacySafeRecommendationConsentEvent[] = [];

  await requireRecommendationConsent(policy, request, { auditSink: memoryAuditSink(events) });

  assert.equal(events.length, 1);
  const serialized = JSON.stringify(events[0]);
  assert.equal(serialized.includes(subjectId), false);
  assert.equal(serialized.includes("alice.example"), false);
  assert.deepEqual(Object.keys(events[0] ?? {}).sort(), [
    "accessBasis",
    "containsPrivateData",
    "containsThirdPartyData",
    "dataUse",
    "decision",
    "protocol",
    "reason",
    "serverSideProcessing",
    "sourceVisibility"
  ]);
});

test("audit sink failure is fail-closed by default and prevents allowed operation", async () => {
  let calls = 0;

  await assert.rejects(
    () => withRecommendationConsent(
      policy,
      request,
      () => {
        calls += 1;
        return "should-not-run";
      },
      {
        auditSink: {
          record() {
            throw new Error("raw sink failure with sensitive context");
          }
        }
      }
    ),
    RecommendationConsentAuditError
  );

  assert.equal(calls, 0);
});

test("audit sink failure on denied requests still denies and never runs operation", async () => {
  let calls = 0;

  await assert.rejects(
    () => withRecommendationConsent(
      undefined,
      request,
      () => {
        calls += 1;
        return "should-not-run";
      },
      {
        auditSink: {
          record() {
            throw new Error("sink failure");
          }
        }
      }
    ),
    RecommendationConsentDeniedError
  );

  assert.equal(calls, 0);
});

test("audit sink failure can be explicitly ignored for allowed operations", async () => {
  let calls = 0;

  const result = await withRecommendationConsent(
    policy,
    request,
    () => {
      calls += 1;
      return "ok";
    },
    {
      auditFailureMode: "ignore",
      auditSink: {
        record() {
          throw new Error("sink failure");
        }
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("executeRecommendationDerivedDataDeletion validates and sanitizes deletion results", async () => {
  const intent = createRecommendationDerivedDataDeletionIntent(subjectId, "2026-05-15T00:00:00.000Z", [
    "profile",
    "embeddings",
    "embeddings"
  ]);

  const result = await executeRecommendationDerivedDataDeletion(intent, {
    deleteDerivedData(receivedIntent) {
      assert.deepEqual(receivedIntent.targets, ["profile", "embeddings"]);
      return {
        deletedTargets: ["embeddings", "profile", "profile"],
        skippedTargets: ["event_history", "event_history"],
        completedAt: "2026-05-15T00:00:01.000Z"
      };
    }
  });

  assert.deepEqual(result.deletedTargets, ["embeddings", "profile"]);
  assert.deepEqual(result.skippedTargets, ["event_history"]);
  assert.equal(result.completedAt, "2026-05-15T00:00:01.000Z");
  assert.equal(JSON.stringify(result).includes(subjectId), false);
});

test("executeRecommendationDerivedDataDeletion sanitizes deleter failures", async () => {
  const intent = createRecommendationDerivedDataDeletionIntent(subjectId, "2026-05-15T00:00:00.000Z");
  let thrown: unknown;

  try {
    await executeRecommendationDerivedDataDeletion(intent, {
      deleteDerivedData() {
        throw new Error(`storage failed for ${subjectId} at https://pod.example/private/resource`);
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof RecommendationDerivedDataDeletionError);
  assert.equal(thrown.message.includes(subjectId), false);
  assert.equal(thrown.message.includes("pod.example"), false);
  assert.equal(JSON.stringify(thrown).includes(subjectId), false);
});

test("executeRecommendationDerivedDataDeletion rejects invalid intents and deleters", async () => {
  const intent = createRecommendationDerivedDataDeletionIntent(subjectId, "2026-05-15T00:00:00.000Z");

  await assert.rejects(
    () => executeRecommendationDerivedDataDeletion(
      null as unknown as RecommendationDerivedDataDeletionIntent,
      { deleteDerivedData: () => ({ deletedTargets: [], skippedTargets: [], completedAt: "now" }) }
    ),
    TypeError
  );

  await assert.rejects(
    () => executeRecommendationDerivedDataDeletion(intent, null as never),
    TypeError
  );
});
