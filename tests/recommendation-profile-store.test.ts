import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryRecommendationProfileStore,
  normalizeRecommendationInterestSignal,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationInterestPolarity,
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

function signal(
  target: RecommendationInterestTarget,
  polarity: RecommendationInterestPolarity,
  strength: number,
  confidence: number,
  privacyBoundary: RecommendationInterestPrivacyBoundary = "local_only",
  expiresAt?: string
): RecommendationInterestSignal {
  return normalizeRecommendationInterestSignal({
    target,
    action: "view",
    polarity,
    strength,
    confidence,
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

test("in-memory recommendation profile store starts with a frozen redacted empty profile", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });
  const profile = await store.readProfile("subject-1");

  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.entries), true);
  assert.equal(profile.schemaVersion, "recommendation-profile.v1");
  assert.equal(profile.signalCount, 0);
  assert.equal(profile.entries.length, 0);
  assert.equal(JSON.stringify(profile).includes("subject-1"), false);
});

test("in-memory recommendation profile store ingests consent-backed signals into redacted entries", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });
  const target: RecommendationInterestTarget = { kind: "canonical_interest", key: "books.fiction" };

  const result = await store.ingestSignals({
    subjectId: "subject-1",
    signals: [signal(target, "positive", 0.5, 0.8), signal(target, "negative", 0.25, 0.4)]
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.acceptedSignalCount, 2);
  assert.equal(result.skippedExpiredSignalCount, 0);
  assert.equal(result.profile.signalCount, 2);
  assert.equal(result.profile.entries.length, 1);
  assert.equal(result.profile.entries[0]?.target.key, "books.fiction");
  assert.equal(result.profile.entries[0]?.signalCount, 2);
  assert.equal(result.profile.entries[0]?.positiveSignalCount, 1);
  assert.equal(result.profile.entries[0]?.negativeSignalCount, 1);
  assert.equal(result.profile.entries[0]?.neutralSignalCount, 0);
  assert.equal(result.profile.entries[0]?.score, 0.30000000000000004);
  assert.equal(result.profile.entries[0]?.confidence, 0.8);
  assert.deepEqual(result.profile.entries[0]?.privacyBoundaries, ["local_only"]);
  assert.deepEqual(result.profile.entries[0]?.protocols, ["activitypub"]);
  assert.deepEqual(result.profile.entries[0]?.sourceVisibilities, ["public"]);
  assert.equal(JSON.stringify(result.profile).includes("subject-1"), false);
});

test("in-memory recommendation profile store skips expired signals", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });
  const result = await store.ingestSignals({
    subjectId: "subject-1",
    signals: [
      signal({ kind: "keyword", key: "expired" }, "positive", 0.9, 0.9, "local_only", "2026-05-14T00:00:00.000Z")
    ]
  });

  assert.equal(result.acceptedSignalCount, 0);
  assert.equal(result.skippedExpiredSignalCount, 1);
  assert.equal(result.profile.signalCount, 0);
  assert.equal(result.profile.entries.length, 0);
});

test("in-memory recommendation profile store rejects disallowed privacy boundaries", async () => {
  const store = createInMemoryRecommendationProfileStore({
    now: () => "2026-05-15T00:00:00.000Z",
    allowedPrivacyBoundaries: ["local_only"]
  });

  await assert.rejects(
    () =>
      store.ingestSignals({
        subjectId: "subject-1",
        signals: [signal({ kind: "keyword", key: "server" }, "positive", 0.5, 0.5, "server_allowed")]
      }),
    TypeError
  );
});

test("in-memory recommendation profile store trims entries by absolute score", async () => {
  const store = createInMemoryRecommendationProfileStore({
    now: () => "2026-05-15T00:00:00.000Z",
    maxEntries: 1
  });

  const result = await store.ingestSignals({
    subjectId: "subject-1",
    signals: [
      signal({ kind: "keyword", key: "low" }, "positive", 0.1, 0.5),
      signal({ kind: "keyword", key: "high" }, "positive", 0.9, 0.9)
    ]
  });

  assert.equal(result.profile.entries.length, 1);
  assert.equal(result.profile.entries[0]?.target.key, "high");
});

test("in-memory recommendation profile store deletes profile target via deletion intent", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });
  await store.ingestSignals({
    subjectId: "subject-1",
    signals: [signal({ kind: "keyword", key: "fiction" }, "positive", 0.5, 0.5)]
  });

  const deletionIntent: RecommendationDerivedDataDeletionIntent = {
    subjectId: "subject-1",
    requestedAt: "2026-05-16T00:00:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["profile"]
  };
  const deleted = await store.deleteProfile(deletionIntent);
  const profile = await store.readProfile("subject-1");

  assert.equal(deleted.signalCount, 0);
  assert.equal(deleted.entries.length, 0);
  assert.equal(profile.signalCount, 0);
  assert.equal(profile.entries.length, 0);
});

test("in-memory recommendation profile store rejects invalid subjects and delete intents", async () => {
  const store = createInMemoryRecommendationProfileStore({ now: () => "2026-05-15T00:00:00.000Z" });

  await assert.rejects(() => store.readProfile("bad\u0000subject"), TypeError);
  await assert.rejects(
    () =>
      store.deleteProfile({
        subjectId: "subject-1",
        requestedAt: "2026-05-16T00:00:00.000Z",
        scope: "recommendation_derived_data",
        targets: ["embeddings"]
      }),
    TypeError
  );
});
