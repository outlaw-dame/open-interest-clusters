import test from "node:test";
import assert from "node:assert/strict";

import {
  writeRecommendationProfileStoreRecord,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord
} from "../src/index.js";

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, RecommendationProfileStoreRecord>();

  async readProfileRecord(subjectKey: string): Promise<RecommendationProfileStoreRecord | null> {
    return this.records.get(subjectKey) ?? null;
  }

  async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
    this.records.set(record.subjectKey, record);
  }

  async deleteProfileRecord(subjectKey: string): Promise<void> {
    this.records.delete(subjectKey);
  }
}

function profile(): RecommendationProfileSnapshot {
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: "2026-08-05T18:00:00.000Z",
    signalCount: 0,
    entries: []
  };
}

function input() {
  return {
    subjectId: "did:web:alice.example",
    writtenAt: "2026-08-05T18:00:00.000Z",
    profile: profile()
  };
}

test("legacy profile writes remain device-owned and local-only", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const record = await writeRecommendationProfileStoreRecord(adapter, input());
  assert.equal(adapter.records.has(record.subjectKey), true);
});

test("user-owned remote profile persistence is allowed", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  const record = await writeRecommendationProfileStoreRecord(adapter, {
    ...input(),
    storageAuthority: "user_owned",
    processingBoundary: "server_allowed"
  });
  assert.equal(adapter.records.has(record.subjectKey), true);
});

test("provider-owned subject-level profile persistence is denied", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "provider_owned",
      processingBoundary: "server_allowed"
    }),
    /storage\.deny\.provider_owned/u
  );
  assert.equal(adapter.records.size, 0);
});

test("shared-operator storage cannot persist subject-level profiles", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "shared_operator",
      processingBoundary: "aggregate_only"
    }),
    /storage\.deny\.shared_operator/u
  );
  assert.equal(adapter.records.size, 0);
});

test("authority metadata must be complete and boundary-compatible", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();

  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "user_owned"
    }),
    /must be supplied together/u
  );

  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "device_owned",
      processingBoundary: "server_allowed"
    }),
    /storage\.deny\.authority_boundary_mismatch/u
  );

  assert.equal(adapter.records.size, 0);
});
