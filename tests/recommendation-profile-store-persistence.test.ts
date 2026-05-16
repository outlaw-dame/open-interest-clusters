import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationProfileSubjectKey,
  createRecommendationProfileStoreRecord,
  deleteRecommendationProfileStoreRecord,
  deserializeRecommendationProfileStoreRecord,
  normalizeRecommendationProfileSnapshot,
  normalizeRecommendationProfileStoreRecord,
  serializeRecommendationProfileStoreRecord,
  readRecommendationProfileStoreRecord,
  writeRecommendationProfileStoreRecord,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord
} from "../src/index.js";

function profileSnapshot(entries = [profileEntry("books.fiction")]): RecommendationProfileSnapshot {
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: "2026-05-16T00:00:00.000Z",
    signalCount: entries.reduce((total, entry) => total + entry.signalCount, 0),
    entries
  };
}

function profileEntry(key: string, expiresAt?: string) {
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
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...(expiresAt === undefined ? {} : { expiresAt })
  };
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

test("profile persistence subject keys are deterministic and do not expose raw subjects", () => {
  const first = createRecommendationProfileSubjectKey({ subjectId: "did:web:alice.example", salt: "provider-secret" });
  const second = createRecommendationProfileSubjectKey({ subjectId: "did:web:alice.example", salt: "provider-secret" });
  const differentSalt = createRecommendationProfileSubjectKey({ subjectId: "did:web:alice.example", salt: "other-secret" });

  assert.equal(first, second);
  assert.notEqual(first, differentSalt);
  assert.match(first, /^profile:[a-f0-9]{64}$/u);
  assert.equal(first.includes("alice"), false);
  assert.throws(() => createRecommendationProfileSubjectKey({ subjectId: `bad${String.fromCharCode(0)}subject` }), TypeError);
  assert.throws(() => createRecommendationProfileSubjectKey({ subjectId: " subject-1" }), TypeError);
  assert.throws(() => createRecommendationProfileSubjectKey({ subjectId: "subject-1 " }), TypeError);
});

test("profile persistence records serialize redacted validated snapshots", () => {
  const record = createRecommendationProfileStoreRecord({
    subjectId: "subject-1",
    salt: "provider-secret",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
  const serialized = serializeRecommendationProfileStoreRecord(record);
  const parsed = deserializeRecommendationProfileStoreRecord(serialized);

  assert.ok(parsed);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.subjectKey, record.subjectKey);
  assert.equal(parsed.profile.entries[0]?.target.key, "books.fiction");
  assert.equal(serialized.includes("subject-1"), false);
  assert.equal(serialized.includes("provider-secret"), false);
});

test("profile snapshot normalization rejects raw source identifiers and corrupt counts", () => {
  const rawIdentifierProfile = profileSnapshot([
    {
      ...profileEntry("books.fiction"),
      sourceEventId: "https://remote.example/activity/1"
    } as never
  ]);
  const corruptCountProfile = {
    ...profileSnapshot(),
    signalCount: 7
  };

  assert.throws(() => normalizeRecommendationProfileSnapshot(rawIdentifierProfile), TypeError);
  assert.throws(() => normalizeRecommendationProfileSnapshot(corruptCountProfile), TypeError);
});

test("profile record and snapshot normalization tolerate unknown outer metadata", () => {
  const record = createRecommendationProfileStoreRecord({
    subjectId: "subject-1",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
  const profileWithMetadata = {
    ...profileSnapshot(),
    futureMetadata: { ignored: true }
  };
  const recordWithMetadata = {
    ...record,
    futureMetadata: { ignored: true },
    profile: profileWithMetadata
  };

  assert.equal(normalizeRecommendationProfileSnapshot(profileWithMetadata).signalCount, 1);
  assert.equal(normalizeRecommendationProfileStoreRecord(recordWithMetadata)?.profile.signalCount, 1);
});

test("profile snapshot normalization prunes expired entries without accepting corrupt records", () => {
  const normalized = normalizeRecommendationProfileSnapshot(profileSnapshot([
    profileEntry("expired", "2026-05-15T00:00:00.000Z"),
    profileEntry("active", "2026-05-17T00:00:00.000Z")
  ]), { now: "2026-05-16T00:00:00.000Z" });

  assert.equal(normalized.signalCount, 1);
  assert.equal(normalized.entries.length, 1);
  assert.equal(normalized.entries[0]?.target.key, "active");
  assert.equal(normalized.updatedAt, "2026-05-16T00:00:00.000Z");
});

test("profile persistence adapter helpers write, read, and delete by derived subject key", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const written = await writeRecommendationProfileStoreRecord(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });
  const read = await readRecommendationProfileStoreRecord(adapter, {
    subjectId: "subject-1",
    salt: "provider-secret",
    now: "2026-05-16T02:00:00.000Z"
  });
  const deletionIntent: RecommendationDerivedDataDeletionIntent = {
    subjectId: "subject-1",
    requestedAt: "2026-05-16T03:00:00.000Z",
    scope: "recommendation_derived_data",
    targets: ["profile"]
  };
  const deleted = await deleteRecommendationProfileStoreRecord(adapter, {
    intent: deletionIntent,
    salt: "provider-secret"
  });

  assert.equal(read?.subjectKey, written.subjectKey);
  assert.equal(read?.profile.signalCount, 1);
  assert.equal(adapter.records.has(written.subjectKey), false);
  assert.deepEqual(adapter.deletedKeys, [written.subjectKey]);
  assert.equal(deleted.signalCount, 0);
  assert.equal(deleted.updatedAt, deletionIntent.requestedAt);
});

test("profile persistence reads can self-heal expired records", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const expired = createRecommendationProfileStoreRecord({
    subjectId: "subject-1",
    writtenAt: "2026-05-14T00:00:00.000Z",
    expiresAt: "2026-05-15T00:00:00.000Z",
    profile: profileSnapshot()
  });
  adapter.records.set(expired.subjectKey, expired);

  const read = await readRecommendationProfileStoreRecord(adapter, {
    subjectId: "subject-1",
    now: "2026-05-16T00:00:00.000Z",
    deleteExpiredRecord: true
  });

  assert.equal(read, null);
  assert.equal(adapter.records.has(expired.subjectKey), false);
  assert.deepEqual(adapter.deletedKeys, [expired.subjectKey]);
});

test("profile persistence rejects invalid schema and serialization payloads", () => {
  const record = createRecommendationProfileStoreRecord({
    subjectId: "subject-1",
    writtenAt: "2026-05-16T01:00:00.000Z",
    profile: profileSnapshot()
  });

  assert.throws(() => deserializeRecommendationProfileStoreRecord("not json"), TypeError);
  assert.throws(
    () => normalizeRecommendationProfileStoreRecord({ ...record, schemaVersion: "bad-version" }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationProfileStoreRecord({ ...record, subjectKey: "subject-1" }),
    TypeError
  );
});
