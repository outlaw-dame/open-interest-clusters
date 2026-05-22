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
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord
} from "../src/index.js";

function profileEntry(key: string) {
  return {
    target: { kind: "canonical_interest" as const, key },
    score: 0.75,
    confidence: 0.8,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries: ["local_only" as const],
    protocols: ["activitypub" as const],
    sourceVisibilities: ["public" as const],
    updatedAt: "2026-05-16T00:00:00.000Z"
  };
}

function profileSnapshot(): RecommendationProfileSnapshot {
  const entries = [profileEntry("books.fiction")];
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
    allowedDataUses: ["local_personalization"],
    privateDataUses: ["local_personalization"],
    serverSideDataUses: ["local_personalization"]
  });
}

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  readonly deletedKeys: string[] = [];

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
    this.records.set(record.subjectKey, {
      ...record,
      writtenAt: "2026-05-16T01:01:00.000Z"
    });
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

test("safe profile persistence verifies local writes without requiring server consent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const result = await writeRecommendationProfileStoreRecordSafely(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
  const read = await readRecommendationProfileStoreRecordSafely(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    now: "2026-05-16T02:00:00.000Z"
  });

  assert.equal(result.storageTarget, "local_app");
  assert.equal(result.verified, true);
  assert.equal(result.consent, undefined);
  assert.equal(read?.subjectKey, result.record.subjectKey);
  assert.equal(read?.profile.signalCount, 1);
});

test("safe profile persistence requires explicit consent for server-side profile storage", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();

  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      subjectId: "subject-1",
      storageTarget: "server_profile",
      writtenAt: "2026-05-16T01:00:00.000Z",
      profile: profileSnapshot()
    }),
    (error) => assertPersistenceError(error, "persistence.deny.server_consent_required")
  );

  assert.equal(adapter.records.size, 0);
});

test("safe profile persistence allows server storage only when consent includes private and server data uses", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const result = await writeRecommendationProfileStoreRecordSafely(adapter, {
    subjectId: "subject-1",
    storageTarget: "server_profile",
    policy: explicitProfileConsent("subject-1"),
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });

  assert.equal(result.storageTarget, "server_profile");
  assert.equal(result.verified, true);
  assert.equal(result.consent?.decision, "allow");
  assert.equal(result.consent?.serverSideProcessing, true);
  assert.equal(adapter.records.has(result.record.subjectKey), true);
});

test("safe profile persistence rejects aggregate-only subject profile writes", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();

  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      subjectId: "subject-1",
      privacyBoundary: "aggregate_only",
      writtenAt: "2026-05-16T01:00:00.000Z",
      profile: profileSnapshot()
    }),
    (error) => assertPersistenceError(error, "persistence.deny.aggregate_subject_profile")
  );

  assert.equal(adapter.records.size, 0);
});

test("safe profile persistence verifies persisted bytes and deletes corrupted writes", async () => {
  const adapter = new CorruptingWriteProfilePersistenceAdapter();
  const subjectKey = createRecommendationProfileSubjectKey({ subjectId: "subject-1" });

  await assert.rejects(
    () => writeRecommendationProfileStoreRecordSafely(adapter, {
      subjectId: "subject-1",
      writtenAt: "2026-05-16T01:00:00.000Z",
      profile: profileSnapshot()
    }),
    (error) => assertPersistenceError(error, "persistence.error.write_verification_failed")
  );

  assert.equal(adapter.records.has(subjectKey), false);
  assert.deepEqual(adapter.deletedKeys, [subjectKey]);
});

test("safe profile persistence maps invalid stored records to privacy-safe persistence errors", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const record = createRecommendationProfileStoreRecord({
    subjectId: "subject-1",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
  adapter.records.set(record.subjectKey, { ...record, schemaVersion: "bad-version" });

  await assert.rejects(
    () => readRecommendationProfileStoreRecordSafely(adapter, {
      subjectId: "subject-1",
      now: "2026-05-16T02:00:00.000Z"
    }),
    (error) => assertPersistenceError(error, "persistence.error.invalid_record")
  );
});

test("safe profile persistence deletes by derived subject key using a deletion intent", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const written = await writeRecommendationProfileStoreRecordSafely(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
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
