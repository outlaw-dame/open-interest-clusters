import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationProfileSubjectKey,
  createRecommendationProfileStoreRecord,
  deleteRecommendationProfileStoreRecordSafely,
  readRecommendationProfileStoreRecordSafely,
  writeRecommendationProfileStoreRecordSafely,
  RecommendationProfilePersistenceError,
  type RecommendationConsentPolicy,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const LOCAL_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  adapterId: "test-safe-local-profile-store",
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
const POD_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  ...LOCAL_MANIFEST,
  adapterId: "test-safe-user-pod-profile-store",
  authority: "user_owned",
  processingBoundary: "server_allowed",
  requiresNetwork: true,
  supportsOffline: false
});
const PROVIDER_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  ...POD_MANIFEST,
  adapterId: "test-safe-provider-profile-store",
  authority: "provider_owned"
});

function profileEntry(
  key: string,
  privacyBoundaries: readonly RecommendationInterestPrivacyBoundary[] = ["local_only"]
) {
  return {
    target: { kind: "canonical_interest" as const, key },
    score: 0.75,
    confidence: 0.8,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries,
    protocols: ["activitypub" as const],
    sourceVisibilities: ["public" as const],
    updatedAt: "2026-05-16T00:00:00.000Z"
  };
}

function profileSnapshot(
  privacyBoundaries: readonly RecommendationInterestPrivacyBoundary[] = ["local_only"]
): RecommendationProfileSnapshot {
  const entries = [profileEntry("books.fiction", privacyBoundaries)];
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: "2026-05-16T00:00:00.000Z",
    signalCount: entries.reduce((total, entry) => total + entry.signalCount, 0),
    entries
  };
}

function explicitProfileConsent(subjectId: string): RecommendationConsentPolicy {
  return Object.freeze({
    subjectId,
    allowedDataUses: ["local_personalization" as const],
    privateDataUses: ["local_personalization" as const],
    serverSideDataUses: ["local_personalization" as const]
  });
}

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  readonly deletedKeys: string[] = [];

  constructor(readonly storageManifest: RecommendationStateStorageAdapterManifest = LOCAL_MANIFEST) {}

  async readProfileRecord(subjectKey: string): Promise<unknown | null> {
    return this.records.get(subjectKey) ?? null;
  }

  async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
    this.records.set(record.subjectKey, record);
  }

  async deleteProfileRecord(subjectKey: string): Promise<void> {
    this.deletedKeys.push(subjectKey);
    this.records.delete(subjectKey);
  }
}

class CorruptingWriteProfilePersistenceAdapter extends MemoryProfilePersistenceAdapter {
  override async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
    this.records.set(record.subjectKey, { ...record, writtenAt: "2026-05-16T01:01:00.000Z" });
  }
}

class ReformattingTimestampProfilePersistenceAdapter extends MemoryProfilePersistenceAdapter {
  override async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
    this.records.set(record.subjectKey, {
      ...record,
      writtenAt: "2026-05-16T01:00:00Z",
      profile: {
        ...record.profile,
        updatedAt: "2026-05-16T00:00:00Z",
        entries: record.profile.entries.map((entry) => ({ ...entry, updatedAt: "2026-05-16T00:00:00Z" }))
      }
    });
  }
}

class FailingReadProfilePersistenceAdapter extends MemoryProfilePersistenceAdapter {
  override async readProfileRecord(): Promise<unknown | null> {
    throw new Error("simulated transient read failure with sensitive adapter details");
  }
}

function assertPersistenceError(
  error: unknown,
  reason: RecommendationProfilePersistenceError["reason"]
): boolean {
  assert.ok(error instanceof RecommendationProfilePersistenceError);
  assert.equal(error.reason, reason);
  return true;
}

function writeInput() {
  return {
    subjectId: "subject-1",
    salt: "provider-secret",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  };
}

test("safe profile persistence verifies local writes without requiring server consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const result = await writeRecommendationProfileStoreRecordSafely(adapter, writeInput());
  const read = await readRecommendationProfileStoreRecordSafely(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    now: "2026-05-16T02:00:00.000Z"
  });

  assert.equal(result.storageTarget, "local_app");
  assert.equal(result.verified, true);
  assert.equal(result.verificationConsistency, "strong");
  assert.equal(result.consent, undefined);
  assert.equal(read?.subjectKey, result.record.subjectKey);
  assert.equal(read?.profile.signalCount, 1);
});

test("safe profile persistence requires explicit consent for user-controlled Pod storage", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(POD_MANIFEST);
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      storageTarget: "user_pod"
    }),
    (error) => assertPersistenceError(error, "persistence.deny.server_consent_required")
  );
  assert.equal(adapter.records.size, 0);
});

test("safe profile persistence allows user-controlled Pod storage with explicit consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(POD_MANIFEST);
  const result = await writeRecommendationProfileStoreRecordSafely(adapter, {
    ...writeInput(),
    storageTarget: "user_pod",
    policy: explicitProfileConsent("subject-1")
  });

  assert.equal(result.storageTarget, "user_pod");
  assert.equal(result.verified, false);
  assert.equal(result.verificationConsistency, "eventual");
  assert.equal(result.consent?.decision, "allow");
  assert.equal(result.consent?.serverSideProcessing, true);
  assert.equal(adapter.records.has(result.record.subjectKey), true);
});

test("safe profile persistence denies provider-owned storage even with consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(PROVIDER_MANIFEST);
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      storageTarget: "server_profile",
      policy: explicitProfileConsent("subject-1")
    }),
    /violates placement policy/u
  );
  assert.equal(adapter.records.size, 0);
});

test("safe profile persistence rejects aggregate-only subject profile writes", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      privacyBoundary: "aggregate_only"
    }),
    (error) => assertPersistenceError(error, "persistence.deny.aggregate_subject_profile")
  );
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      profile: profileSnapshot(["aggregate_only"])
    }),
    (error) => assertPersistenceError(error, "persistence.deny.aggregate_subject_profile")
  );
  assert.equal(adapter.records.size, 0);
});

test("safe profile persistence semantically verifies timestamp reformatting", async () => {
  const adapter = new ReformattingTimestampProfilePersistenceAdapter();
  const result = await writeRecommendationProfileStoreRecordSafely(adapter, writeInput());
  assert.equal(result.verified, true);
  assert.equal(adapter.deletedKeys.length, 0);
  assert.equal(adapter.records.has(result.record.subjectKey), true);
});

test("safe profile persistence does not delete records when verification reads transiently fail", async () => {
  const adapter = new FailingReadProfilePersistenceAdapter();
  const subjectKey = createRecommendationProfileSubjectKey({ subjectId: "subject-1" });
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      salt: undefined,
      deleteOnVerificationFailure: true
    }),
    (error) => assertPersistenceError(error, "persistence.error.write_verification_failed")
  );
  assert.equal(adapter.records.has(subjectKey), true);
  assert.deepEqual(adapter.deletedKeys, []);
});

test("safe profile persistence verifies persisted content and can clean up confirmed corrupted writes", async () => {
  const adapter = new CorruptingWriteProfilePersistenceAdapter();
  const subjectKey = createRecommendationProfileSubjectKey({ subjectId: "subject-1" });
  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      ...writeInput(),
      salt: undefined,
      deleteOnVerificationFailure: true
    }),
    (error) => assertPersistenceError(error, "persistence.error.write_verification_failed")
  );
  assert.equal(adapter.records.has(subjectKey), false);
  assert.deepEqual(adapter.deletedKeys, [subjectKey]);
});

test("safe profile persistence maps invalid stored records to privacy-safe persistence errors", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const record = createRecommendationProfileStoreRecord(writeInput());
  adapter.records.set(record.subjectKey, { ...record, schemaVersion: "bad-version" });
  await assert.rejects(
    () => readRecommendationProfileStoreRecordSafely(adapter, {
      subjectId: "subject-1",
      salt: "provider-secret",
      now: "2026-05-16T02:00:00.000Z"
    }),
    (error) => assertPersistenceError(error, "persistence.error.invalid_record")
  );
});

test("safe profile persistence deletes by derived subject key using a deletion intent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const written = await writeRecommendationProfileStoreRecordSafely(adapter, writeInput());
  const deletionIntent: RecommendationDerivedDataDeletionIntent = {
    subjectId: "subject-1",
    requestedAt: "2026-05-16T03:00:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["profile"]
  };
  const deleted = await deleteRecommendationProfileStoreRecordSafely(adapter, {
    intent: deletionIntent,
    salt: "provider-secret"
  });

  assert.equal(adapter.records.has(written.record.subjectKey), false);
  assert.deepEqual(adapter.deletedKeys, [written.record.subjectKey]);
  assert.equal(deleted.signalCount, 0);
  assert.equal(deleted.updatedAt, deletionIntent.requestedAt);
});
