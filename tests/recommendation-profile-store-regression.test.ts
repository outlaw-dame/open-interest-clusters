import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryRecommendationProfileStore,
  normalizeRecommendationInterestSignal,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestSignal,
  type RecommendationInterestTarget
} from "../src/index.js";

const consentEvent: PrivacySafeRecommendationConsentEvent = {
  decision: "allow",
  reason: "consent.allow.explicit",
  dataUse: "ranking",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web",
  containsPrivateData: false,
  containsThirdPartyData: false,
  serverSideProcessing: false
};

function createSignal(
  target: RecommendationInterestTarget,
  privacyBoundary: RecommendationInterestPrivacyBoundary = "local_only",
  expiresAt?: string
): RecommendationInterestSignal {
  return normalizeRecommendationInterestSignal({
    target,
    action: "view",
    polarity: "positive",
    strength: 0.9,
    confidence: 0.9,
    dataUse: "ranking",
    privacyBoundary,
    evidence: {
      sourceItemKind: "post",
      protocol: "activitypub",
      sourceVisibility: "public",
      accessBasis: "public_web",
      trustBoundary: "remote_provider",
      observedAt: "2026-05-15T00:00:00.000Z"
    },
    consent: consentEvent,
    ...(expiresAt === undefined ? {} : { expiresAt })
  });
}

test("profile store rejects failed batches without partial persistence", async () => {
  const store = createInMemoryRecommendationProfileStore({
    now: () => "2026-05-15T00:00:00.000Z",
    allowedPrivacyBoundaries: ["local_only"]
  });

  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [createSignal({ kind: "keyword", key: "existing" })]
  });

  await assert.rejects(
    () =>
      store.ingestSignals({
        subjectId: "subject-1",
        signals: [
          createSignal({ kind: "keyword", key: "should-not-persist" }),
          createSignal({ kind: "keyword", key: "server" }, "server_allowed")
        ]
      }),
    TypeError
  );

  const profile = await store.readProfile("subject-1");
  assert.equal(profile.signalCount, 1);
  assert.equal(profile.entries.length, 1);
  assert.equal(profile.entries[0]?.target.key, "existing");
});

test("profile store prunes expired entries before returning snapshots", async () => {
  let now = "2026-05-15T00:00:00.000Z";
  const store = createInMemoryRecommendationProfileStore({ now: () => now });

  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [createSignal({ kind: "keyword", key: "temporary" }, "local_only", "2026-05-16T00:00:00.000Z")]
  });
  assert.equal((await store.readProfile("subject-1")).entries.length, 1);

  now = "2026-05-16T00:00:00.000Z";
  const pruned = await store.readProfile("subject-1");

  assert.equal(pruned.signalCount, 0);
  assert.equal(pruned.entries.length, 0);
});

test("profile store keeps aggregate entries until the latest contributing expiration", async () => {
  let now = "2026-05-15T00:00:00.000Z";
  const store = createInMemoryRecommendationProfileStore({ now: () => now });

  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [
      createSignal({ kind: "keyword", key: "aggregate" }, "local_only", "2026-05-16T00:00:00.000Z"),
      createSignal({ kind: "keyword", key: "aggregate" }, "local_only", "2026-05-18T00:00:00.000Z")
    ]
  });

  now = "2026-05-17T00:00:00.000Z";
  const stillValid = await store.readProfile("subject-1");
  assert.equal(stillValid.entries.length, 1);
  assert.equal(stillValid.entries[0]?.expiresAt, "2026-05-18T00:00:00.000Z");

  now = "2026-05-18T00:00:00.000Z";
  const expired = await store.readProfile("subject-1");
  assert.equal(expired.entries.length, 0);
});

test("profile store treats an unexpiring contributing signal as an unexpiring aggregate", async () => {
  let now = "2026-05-15T00:00:00.000Z";
  const store = createInMemoryRecommendationProfileStore({ now: () => now });

  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [
      createSignal({ kind: "keyword", key: "durable" }, "local_only", "2026-05-16T00:00:00.000Z"),
      createSignal({ kind: "keyword", key: "durable" })
    ]
  });

  now = "2026-05-20T00:00:00.000Z";
  const profile = await store.readProfile("subject-1");
  assert.equal(profile.entries.length, 1);
  assert.equal(profile.entries[0]?.expiresAt, undefined);
});

test("profile store snapshot ordering uses the composite target key", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });

  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [
      createSignal({ kind: "keyword", key: "same" }),
      createSignal({ kind: "entity", key: "same" })
    ]
  });

  const profile = await store.readProfile("subject-1");
  assert.deepEqual(
    profile.entries.map((entry) => `${entry.target.kind}:${entry.target.key}`),
    ["entity:same", "keyword:same"]
  );
});
