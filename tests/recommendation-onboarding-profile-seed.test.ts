import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RECOMMENDATION_ONBOARDING_PROFILE_SEED_SCHEMA_VERSION,
  RecommendationConsentDeniedError,
  createInMemoryRecommendationProfileStore,
  createRecommendationCatalogIndex,
  createRecommendationOnboardingProfileSeed,
  createRecommendationOnboardingSelection,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentPolicy,
  type RecommendationProfileStore
} from "../src/index.js";

const SUBJECT_ID = "user-123";
const SELECTED_AT = "2026-05-19T00:00:00.000Z";

function localPersonalizationPolicy(subjectId = SUBJECT_ID): RecommendationConsentPolicy {
  return Object.freeze({
    subjectId,
    allowedDataUses: Object.freeze(["local_personalization"]),
    privateDataUses: Object.freeze(["local_personalization"])
  });
}

test("onboarding profile seed turns explicit selections into local-only interest signals and profile entries", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedCanonicalTagIds: ["ai.generative"],
    allowAutoFollowHashtags: false,
    selectedAt: SELECTED_AT,
    storageTarget: "local_app"
  });
  const auditEvents: PrivacySafeRecommendationConsentEvent[] = [];
  const result = await createRecommendationOnboardingProfileSeed({
    subjectId: SUBJECT_ID,
    catalogIndex,
    selection,
    policy: localPersonalizationPolicy(),
    enforcementOptions: {
      auditSink: {
        record(event) {
          auditEvents.push(event);
        }
      }
    }
  });
  const profileTargets = new Set(result.profile.entries.map((entry) => `${entry.target.kind}:${entry.target.key}`));

  assert.equal(result.schemaVersion, RECOMMENDATION_ONBOARDING_PROFILE_SEED_SCHEMA_VERSION);
  assert.equal(result.consent.decision, "allow");
  assert.equal(result.consent.reason, "consent.allow.explicit");
  assert.equal(result.consent.containsPrivateData, true);
  assert.equal(result.consent.serverSideProcessing, false);
  assert.equal(auditEvents.length, 1);
  assert.equal(result.signals.length, result.signalCount);
  assert.ok(result.canonicalInterestSignalCount > 0);
  assert.ok(result.hashtagSignalCount > 0);
  assert.ok(profileTargets.has("canonical_interest:gaming"));
  assert.ok(profileTargets.has("canonical_interest:gaming.playstation"));
  assert.ok(profileTargets.has("canonical_interest:gaming.xbox"));
  assert.ok(profileTargets.has("canonical_interest:gaming.showcases"));
  assert.ok(profileTargets.has("canonical_interest:ai.generative"));
  assert.ok(profileTargets.has("hashtag:stateofplay"));
  assert.ok(profileTargets.has("hashtag:xboxgamesshowcase"));
  assert.ok(profileTargets.has("hashtag:summergamefest"));
  assert.ok(profileTargets.has("hashtag:gamingshowcases"));
  assert.ok(result.signals.every((signal) => signal.privacyBoundary === "local_only"));
  assert.ok(result.signals.every((signal) => signal.evidence.protocol === "app_local"));
  assert.ok(result.signals.every((signal) => signal.evidence.accessBasis === "owner"));
  assert.ok(result.signals.every((signal) => signal.action === "select"));
  assert.equal(JSON.stringify(result.signals).includes(SUBJECT_ID), false);
  assert.equal(JSON.stringify(result.profile).includes(SUBJECT_ID), false);
});

test("onboarding profile seed uses the supplied profile store for durable caller-controlled ingestion", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const profileStore = createInMemoryRecommendationProfileStore({ now: () => SELECTED_AT });
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["apple"],
    allowAutoFollowHashtags: true,
    selectedAt: SELECTED_AT
  });

  const result = await createRecommendationOnboardingProfileSeed({
    subjectId: SUBJECT_ID,
    catalogIndex,
    selection,
    policy: localPersonalizationPolicy(),
    profileStore
  });
  const persisted = await profileStore.readProfile(SUBJECT_ID);
  const persistedTargets = new Set(persisted.entries.map((entry) => `${entry.target.kind}:${entry.target.key}`));

  assert.equal(result.profile.signalCount, persisted.signalCount);
  assert.ok(persistedTargets.has("canonical_interest:apple"));
  assert.ok(persistedTargets.has("canonical_interest:apple.products"));
  assert.ok(persistedTargets.has("hashtag:iphone"));
  assert.ok(persistedTargets.has("hashtag:wwdc26"));
});

test("onboarding profile seed is deny-by-default and does not ingest without explicit consent", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: SELECTED_AT
  });
  let ingestCalled = false;
  const profileStore: RecommendationProfileStore = {
    async ingestSignals() {
      ingestCalled = true;
      throw new Error("ingest should not be called");
    },
    async readProfile() {
      throw new Error("read should not be called");
    },
    async deleteProfile() {
      throw new Error("delete should not be called");
    }
  };

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({
      subjectId: SUBJECT_ID,
      catalogIndex,
      selection,
      policy: null,
      profileStore
    }),
    RecommendationConsentDeniedError
  );
  assert.equal(ingestCalled, false);
});

test("onboarding profile seed rejects revoked consent before deriving profile state", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: SELECTED_AT
  });

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({
      subjectId: SUBJECT_ID,
      catalogIndex,
      selection,
      policy: Object.freeze({
        ...localPersonalizationPolicy(),
        revokedAt: "2026-05-19T00:01:00.000Z"
      })
    }),
    (error: unknown) => error instanceof RecommendationConsentDeniedError && error.reason === "consent.deny.revoked"
  );
});

test("onboarding profile seed blocks server-side profile seeding unless the policy explicitly allows it", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: SELECTED_AT
  });

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({
      subjectId: SUBJECT_ID,
      catalogIndex,
      selection,
      policy: localPersonalizationPolicy(),
      privacyBoundary: "server_allowed"
    }),
    (error: unknown) => error instanceof RecommendationConsentDeniedError && error.reason === "consent.deny.server_processing_not_allowed"
  );

  const serverAllowed = await createRecommendationOnboardingProfileSeed({
    subjectId: SUBJECT_ID,
    catalogIndex,
    selection,
    policy: Object.freeze({
      subjectId: SUBJECT_ID,
      allowedDataUses: Object.freeze(["local_personalization"]),
      privateDataUses: Object.freeze(["local_personalization"]),
      serverSideDataUses: Object.freeze(["local_personalization"])
    }),
    privacyBoundary: "server_allowed",
    profileStore: createInMemoryRecommendationProfileStore({
      allowedPrivacyBoundaries: ["server_allowed"],
      now: () => SELECTED_AT
    })
  });

  assert.ok(serverAllowed.signals.every((signal) => signal.privacyBoundary === "server_allowed"));
  assert.equal(serverAllowed.consent.serverSideProcessing, true);
});

test("onboarding profile seed validates timestamps and expiration", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: SELECTED_AT
  });

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({
      subjectId: SUBJECT_ID,
      catalogIndex,
      selection,
      policy: localPersonalizationPolicy(),
      observedAt: "not-a-date"
    }),
    TypeError
  );

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({
      subjectId: SUBJECT_ID,
      catalogIndex,
      selection,
      policy: localPersonalizationPolicy(),
      expiresAt: SELECTED_AT
    }),
    TypeError
  );

  const expiring = await createRecommendationOnboardingProfileSeed({
    subjectId: SUBJECT_ID,
    catalogIndex,
    selection,
    policy: localPersonalizationPolicy(),
    expiresAt: "2026-06-19T00:00:00.000Z"
  });

  assert.ok(expiring.signals.every((signal) => signal.expiresAt === "2026-06-19T00:00:00.000Z"));
  assert.ok(expiring.profile.entries.every((entry) => entry.expiresAt === "2026-06-19T00:00:00.000Z"));
});
