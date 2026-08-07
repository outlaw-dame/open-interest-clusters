import test from "node:test";
import assert from "node:assert/strict";

import {
  writeRecommendationProfileStoreRecord,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const LOCAL_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  adapterId: "test-device-profile-store",
  domains: Object.freeze(["interest_profile"]),
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
  adapterId: "test-user-pod-profile-store",
  authority: "user_owned",
  processingBoundary: "server_allowed",
  requiresNetwork: true,
  supportsOffline: false
});
const PROVIDER_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  ...POD_MANIFEST,
  adapterId: "test-provider-profile-store",
  authority: "provider_owned"
});

class MemoryProfilePersistenceAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, RecommendationProfileStoreRecord>();
  constructor(readonly storageManifest?: RecommendationStateStorageAdapterManifest) {}
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

test("profile writes reject adapters without placement manifests before I/O", async () => {
  const adapter = new MemoryProfilePersistenceAdapter();
  await assert.rejects(writeRecommendationProfileStoreRecord(adapter, input()), /storage adapter manifest/u);
  assert.equal(adapter.records.size, 0);
});

test("device-owned local profile persistence is allowed from the adapter manifest", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(LOCAL_MANIFEST);
  const record = await writeRecommendationProfileStoreRecord(adapter, input());
  assert.equal(adapter.records.has(record.subjectKey), true);
});

test("user-owned remote profile persistence is allowed", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(POD_MANIFEST);
  const record = await writeRecommendationProfileStoreRecord(adapter, {
    ...input(),
    storageAuthority: "user_owned",
    processingBoundary: "server_allowed"
  });
  assert.equal(adapter.records.has(record.subjectKey), true);
});

test("provider-owned profile manifests are denied before subject-level writes", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(PROVIDER_MANIFEST);
  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, input()),
    /violates placement policy/u
  );
  assert.equal(adapter.records.size, 0);
});

test("write authority assertions must match the adapter manifest", async () => {
  const adapter = new MemoryProfilePersistenceAdapter(LOCAL_MANIFEST);
  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "user_owned",
      processingBoundary: "server_allowed"
    }),
    /does not match the persistence adapter manifest/u
  );
  await assert.rejects(
    writeRecommendationProfileStoreRecord(adapter, {
      ...input(),
      storageAuthority: "device_owned"
    }),
    /must be supplied together/u
  );
  assert.equal(adapter.records.size, 0);
});
