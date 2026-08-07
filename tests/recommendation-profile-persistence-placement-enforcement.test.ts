import test from "node:test";
import assert from "node:assert/strict";

import {
  writeRecommendationProfileStoreRecord,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileStoreRecord
} from "../src/recommendation/profile-store-persistence.js";

const NOW = "2026-08-07T00:00:00Z";
const PROFILE = Object.freeze({
  schemaVersion: "recommendation-profile.v1" as const,
  updatedAt: NOW,
  signalCount: 0,
  entries: Object.freeze([])
});

function adapter(
  manifest: RecommendationProfilePersistenceAdapter["stateStorageManifest"]
): RecommendationProfilePersistenceAdapter & { writes: RecommendationProfileStoreRecord[] } {
  const writes: RecommendationProfileStoreRecord[] = [];
  return {
    ...(manifest === undefined ? {} : { stateStorageManifest: manifest }),
    writes,
    async readProfileRecord() { return null; },
    async writeProfileRecord(record) { writes.push(record); },
    async deleteProfileRecord() {}
  };
}

const INPUT = Object.freeze({
  subjectId: "alice",
  profile: PROFILE,
  writtenAt: NOW
});

test("profile persistence rejects adapters without placement manifests before I/O", async () => {
  const target = adapter(undefined);
  await assert.rejects(
    writeRecommendationProfileStoreRecord(target, INPUT),
    /persistence adapter/u
  );
  assert.equal(target.writes.length, 0);
});

test("profile persistence rejects policy-violating network-backed device manifests before I/O", async () => {
  const target = adapter({
    adapterId: "remote-disguised-as-local",
    domains: ["interest_profile"],
    authority: "device_owned",
    processingBoundary: "local_only",
    persistence: "persistent",
    requiresNetwork: true,
    supportsOffline: false,
    userExportable: true,
    userDeletable: true,
    encryptedAtRest: true
  });
  await assert.rejects(
    writeRecommendationProfileStoreRecord(target, INPUT),
    /violates placement policy/u
  );
  assert.equal(target.writes.length, 0);
});

test("profile persistence accepts a valid local-first manifest and binds caller assertions", async () => {
  const target = adapter({
    adapterId: "indexeddb-profile-store",
    domains: ["interest_profile"],
    authority: "device_owned",
    processingBoundary: "local_only",
    persistence: "persistent",
    requiresNetwork: false,
    supportsOffline: true,
    userExportable: true,
    userDeletable: true,
    encryptedAtRest: false
  });
  await writeRecommendationProfileStoreRecord(target, {
    ...INPUT,
    storageAuthority: "device_owned",
    processingBoundary: "local_only"
  });
  assert.equal(target.writes.length, 1);

  await assert.rejects(
    writeRecommendationProfileStoreRecord(target, {
      ...INPUT,
      storageAuthority: "user_owned",
      processingBoundary: "server_allowed"
    }),
    /does not match the adapter manifest/u
  );
  assert.equal(target.writes.length, 1);
});
