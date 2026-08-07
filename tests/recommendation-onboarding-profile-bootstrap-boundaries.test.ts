import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  RecommendationProfilePersistenceError,
  bootstrapRecommendationProfileFromOnboarding,
  normalizeRecommendationCatalog,
  type RecommendationCatalog,
  type RecommendationConsentPolicy,
  type RecommendationDataUse,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const SUBJECT_ID = "bootstrap-boundary-user";
const SELECTED_AT = "2026-05-22T00:00:00.000Z";
const LOCAL_USES: readonly RecommendationDataUse[] = Object.freeze(["local_personalization"]);
const LOCAL_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  adapterId: "test-onboarding-boundary-local-store",
  domains: ["interest_profile"] as const,
  authority: "device_owned",
  processingBoundary: "local_only",
  persistence: "persistent",
  requiresNetwork: false,
  supportsOffline: true,
  userExportable: true,
  userDeletable: true,
  encryptedAtRest: false
});

function policy(): RecommendationConsentPolicy {
  return Object.freeze({
    subjectId: SUBJECT_ID,
    allowedDataUses: LOCAL_USES,
    privateDataUses: LOCAL_USES
  });
}

function boundaryCatalog(): RecommendationCatalog {
  return normalizeRecommendationCatalog({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: "bootstrap-boundary.catalog.v1",
    topics: [
      { id: "safe", kind: "primary", label: "Safe", canonicalTagIds: ["safe"] },
      {
        id: "guarded",
        kind: "primary",
        label: "Guarded",
        sensitive: true,
        subtopicIds: ["guarded.core"],
        canonicalTagIds: ["guarded"]
      },
      {
        id: "guarded.core",
        kind: "subtopic",
        label: "Guarded Core",
        primaryTopicId: "guarded",
        canonicalTagIds: ["guarded.core"]
      }
    ],
    canonicalTags: [
      { id: "safe", displayLabel: "Safe", variants: ["Safe"], hashtags: ["#Safe"], parentTopicIds: ["safe"] },
      { id: "guarded", displayLabel: "Guarded", variants: ["Guarded"], hashtags: ["#Guarded"], parentTopicIds: ["guarded"] },
      {
        id: "guarded.core",
        displayLabel: "Guarded Core",
        variants: ["GuardedCore"],
        hashtags: ["#GuardedCore"],
        parentTopicIds: ["guarded.core"]
      }
    ]
  });
}

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly storageManifest = LOCAL_MANIFEST;
  readonly records = new Map<string, RecommendationProfileStoreRecord>();

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

class FailingProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly storageManifest = LOCAL_MANIFEST;
  async readProfileRecord(_subjectKey: string): Promise<unknown | null> {
    return null;
  }

  async writeProfileRecord(_record: RecommendationProfileStoreRecord): Promise<void> {
    throw new Error("simulated adapter write failure");
  }

  async deleteProfileRecord(_subjectKey: string): Promise<void> {}
}

test("bootstrap rejects guarded selections without explicit opt-in before persistence", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();

  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      catalog: boundaryCatalog(),
      selectedTopicIds: ["guarded"],
      selectedAt: SELECTED_AT,
      policy: policy(),
      persistence: { adapter }
    }),
    (error: unknown) => error instanceof TypeError &&
      error.message === "Recommendation onboarding profile seed requires explicit sensitive selection opt-in."
  );

  assert.equal(adapter.records.size, 0);
});

test("bootstrap allows guarded selections after explicit opt-in", async () => {
  const result = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT_ID,
    catalog: boundaryCatalog(),
    selectedTopicIds: ["guarded"],
    allowSensitiveSelections: true,
    selectedAt: SELECTED_AT,
    policy: policy()
  });
  const targetKeys = result.profile.entries.map((entry) => entry.target.key);

  assert.equal(result.consent.decision, "allow");
  assert.ok(targetKeys.includes("guarded"));
  assert.ok(targetKeys.includes("guarded.core"));
  assert.ok(result.selectedCanonicalInterestIds.includes("guarded"));
  assert.ok(result.selectedCanonicalInterestIds.includes("guarded.core"));
});

test("bootstrap rejects aggregate-only subject profile state before persistence", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();

  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      catalog: boundaryCatalog(),
      selectedTopicIds: ["safe"],
      selectedAt: SELECTED_AT,
      policy: policy(),
      privacyBoundary: "aggregate_only",
      persistence: { adapter }
    }),
    (error: unknown) => error instanceof TypeError &&
      error.message === "Recommendation onboarding profile seed cannot create subject-level aggregate-only profile state."
  );

  assert.equal(adapter.records.size, 0);
});

test("bootstrap maps persistence failures to sanitized errors", async () => {
  await assert.rejects(
    bootstrapRecommendationProfileFromOnboarding({
      subjectId: SUBJECT_ID,
      catalog: boundaryCatalog(),
      selectedTopicIds: ["safe"],
      selectedAt: SELECTED_AT,
      policy: policy(),
      persistence: { adapter: new FailingProfilePersistenceAdapter() }
    }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError &&
      error.reason === "persistence.error.adapter_write_failed" &&
      !error.message.includes("simulated adapter write failure")
  );
});
