import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_ONBOARDING_PROFILE_BOOTSTRAP_SCHEMA_VERSION,
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RecommendationConsentDeniedError,
  bootstrapRecommendationProfileFromOnboarding,
  createInMemoryRecommendationProfileStore,
  createRecommendationCatalogIndex,
  type RecommendationConsentPolicy,
  type RecommendationDataUse,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStore,
  type RecommendationProfileStoreRecord
} from "../src/index.js";

const SUBJECT_ID = "bootstrap-user-123";
const SELECTED_AT = "2026-05-22T00:00:00.000Z";
const LOCAL_PERSONALIZATION_USES: readonly RecommendationDataUse[] = Object.freeze(["local_personalization"]);

function localPersonalizationPolicy(subjectId = SUBJECT_ID): RecommendationConsentPolicy {
  return Object.freeze({
    subjectId,
    allowedDataUses: LOCAL_PERSONALIZATION_USES,
    privateDataUses: LOCAL_PERSONALIZATION_USES
  });
}

function serverPersonalizationPolicy(subjectId = SUBJECT_ID): RecommendationConsentPolicy {
  return Object.freeze({
    subjectId,
    allowedDataUses: LOCAL_PERSONALIZATION_USES,
    privateDataUses: LOCAL_PERSONALIZATION_USES,
    serverSideDataUses: LOCAL_PERSONALIZATION_USES
  });
}

function rejectingProfileStore(onIngest?: () => void): RecommendationProfileStore {
  return {
    async ingestSignals() {
      onIngest?.();
      throw new Error("ingest should not be called");
    },
    async readProfile(): Promise<RecommendationProfileSnapshot> {
      throw new Error("read should not be called");
    },
    async deleteProfile(): Promise<RecommendationProfileSnapshot> {
      throw new Error("delete should not be called");
    }
  };
}

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();

  async readProfileRecord(subjectKey: string): Promise<unknown | null> {
    return this.records.get(subjectKey) ?? null;
  }

  async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
    this.records.set(record.subjectKey, record);
  }

  async deleteProfileRecord(subjectKey: string): Promise<void> {
    this.records.delete(subjectKey);
  }
}

function canonicalTargets(profile: RecommendationProfileSnapshot): Set<string> {
  return new Set(
    profile.entries
      .filter((entry) => entry.target.kind === "canonical_interest")
      .map((entry) => entry.target.key)
  );
}

test("onboarding bootstrap creates a privacy-safe local profile and optional hashtag follow plan", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const result = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalogIndex,
    selectedTopicIds: ["gaming"],
    selectedCanonicalTagIds: ["ai.generative"],
    allowAutoFollowHashtags: true,
    selectedAt: SELECTED_AT,
    policy: localPersonalizationPolicy()
  });
  const targets = canonicalTargets(result.profile);

  assert.equal(result.schemaVersion, RECOMMENDATION_ONBOARDING_PROFILE_BOOTSTRAP_SCHEMA_VERSION);
  assert.equal(result.storageTarget, "local_app");
  assert.equal(result.persisted, false);
  assert.equal(result.consent.decision, "allow");
  assert.equal(result.consent.serverSideProcessing, false);
  assert.equal(result.hashtagFollowPlan.allowAutoFollowHashtags, true);
  assert.equal(result.hashtagFollowPlan.requiresAccountFollowAction, true);
  assert.ok(result.hashtagFollowPlan.hashtags.includes("stateofplay"));
  assert.ok(result.hashtagFollowPlan.hashtags.includes("xboxgamesshowcase"));
  assert.ok(result.hashtagFollowPlan.hashtags.includes("summergamefest"));
  assert.ok(result.hashtagFollowPlan.hashtags.includes("gamingshowcases"));
  assert.ok(targets.has("gaming"));
  assert.ok(targets.has("gaming.playstation"));
  assert.ok(targets.has("gaming.xbox"));
  assert.ok(targets.has("gaming.showcases"));
  assert.ok(targets.has("ai.generative"));
  assert.deepEqual(result.selectedCanonicalInterestIds, [...result.selectedCanonicalInterestIds].sort());
  assert.equal(JSON.stringify(result.profile).includes(SUBJECT_ID), false);
  assert.equal(JSON.stringify(result).includes(`\"subjectId\":\"${SUBJECT_ID}\"`), false);
});

test("onboarding bootstrap reports selected ids from the current onboarding run", async () => {
  const profileStore = createInMemoryRecommendationProfileStore({ now: () => SELECTED_AT });
  const first = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["apple"],
    selectedAt: SELECTED_AT,
    policy: localPersonalizationPolicy(),
    profileStore
  });
  const second = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: "2026-05-22T01:00:00.000Z",
    policy: localPersonalizationPolicy(),
    profileStore
  });
  const mergedTargets = canonicalTargets(second.profile);

  assert.ok(first.selectedCanonicalInterestIds.includes("apple"));
  assert.ok(mergedTargets.has("apple"));
  assert.ok(mergedTargets.has("gaming"));
  assert.ok(second.selectedCanonicalInterestIds.includes("gaming"));
  assert.ok(second.selectedCanonicalInterestIds.includes("gaming.playstation"));
  assert.equal(second.selectedCanonicalInterestIds.includes("apple"), false);
  assert.equal(second.selectedCanonicalInterestIds.includes("apple.products"), false);
});

test("onboarding bootstrap does not create a follow action unless auto-follow is explicit", async () => {
  const result = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    allowAutoFollowHashtags: false,
    selectedAt: SELECTED_AT,
    policy: localPersonalizationPolicy()
  });

  assert.equal(result.hashtagFollowPlan.allowAutoFollowHashtags, false);
  assert.equal(result.hashtagFollowPlan.requiresAccountFollowAction, false);
  assert.deepEqual(result.hashtagFollowPlan.hashtags, []);
});

test("onboarding bootstrap is deny-by-default and performs no ingestion or persistence without consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  let ingestCalled = false;

  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
      selectedTopicIds: ["gaming"],
      selectedAt: SELECTED_AT,
      policy: null,
      profileStore: rejectingProfileStore(() => {
        ingestCalled = true;
      }),
      persistence: { adapter }
    }),
    (error: unknown) => error instanceof RecommendationConsentDeniedError && error.reason === "consent.deny.default"
  );

  assert.equal(ingestCalled, false);
  assert.equal(adapter.records.size, 0);
});

test("onboarding bootstrap rejects revoked consent before profile persistence", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  let ingestCalled = false;

  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
      selectedTopicIds: ["gaming"],
      selectedAt: SELECTED_AT,
      policy: Object.freeze({
        ...localPersonalizationPolicy(),
        revokedAt: "2026-05-22T00:01:00.000Z"
      }),
      profileStore: rejectingProfileStore(() => {
        ingestCalled = true;
      }),
      persistence: { adapter }
    }),
    (error: unknown) => error instanceof RecommendationConsentDeniedError && error.reason === "consent.deny.revoked"
  );

  assert.equal(ingestCalled, false);
  assert.equal(adapter.records.size, 0);
});

test("onboarding bootstrap persists only when a persistence adapter is provided", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const withoutPersistence = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["apple"],
    selectedAt: SELECTED_AT,
    policy: localPersonalizationPolicy()
  });
  const withPersistence = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["apple"],
    selectedAt: SELECTED_AT,
    policy: localPersonalizationPolicy(),
    persistence: { adapter, salt: "device-secret" }
  });

  assert.equal(withoutPersistence.persisted, false);
  assert.equal(adapter.records.size, 1);
  assert.equal(withPersistence.persisted, true);
  assert.equal(withPersistence.persistence?.storageTarget, "local_app");
  assert.equal(withPersistence.persistence?.verified, true);
});

test("onboarding bootstrap denies server profile target without server-side consent before ingestion", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  let ingestCalled = false;

  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      storageTarget: "server_profile",
      catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
      selectedTopicIds: ["gaming"],
      selectedAt: SELECTED_AT,
      policy: localPersonalizationPolicy(),
      profileStore: rejectingProfileStore(() => {
        ingestCalled = true;
      }),
      persistence: { adapter }
    }),
    (error: unknown) => error instanceof RecommendationConsentDeniedError && error.reason === "consent.deny.server_processing_not_allowed"
  );

  assert.equal(ingestCalled, false);
  assert.equal(adapter.records.size, 0);
});

test("onboarding bootstrap can persist to server profile with explicit server-side consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const result = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    storageTarget: "server_profile",
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: SELECTED_AT,
    policy: serverPersonalizationPolicy(),
    persistence: { adapter }
  });

  assert.equal(result.storageTarget, "server_profile");
  assert.equal(result.selection.storageTarget, "provider_storage");
  assert.equal(result.persisted, true);
  assert.equal(result.persistence?.storageTarget, "server_profile");
  assert.equal(result.persistence?.verified, false);
  assert.equal(result.persistence?.verificationConsistency, "eventual");
  assert.equal(adapter.records.size, 1);
});
