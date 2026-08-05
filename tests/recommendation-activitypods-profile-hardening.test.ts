import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationActivityPodsProfilePersistenceAdapter
} from "../src/recommendation/activitypods-profile-persistence-adapter.js";
import {
  normalizeRecommendationActivityPodsResourceGrantEvidence,
  type RecommendationActivityPodsResourceGrantEvidenceInput
} from "../src/recommendation/activitypods-resource-authorization.js";
import type { RecommendationProfileStoreRecord } from "../src/recommendation/profile-store-persistence.js";

const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const STORAGE = "https://pod.example/alice/data/";
const CONTAINER = "https://pod.example/alice/data/recommendation-profiles/";
const SUBJECT_KEY = `profile:${"c".repeat(64)}`;
const RESOURCE = `${CONTAINER}${encodeURIComponent(SUBJECT_KEY)}.jsonld`;
const NOW = "2026-08-05T12:00:00Z";
const REGISTRATION = "https://pod.example/alice/data/application-registrations/1";
const ACCESS_GRANT = "https://pod.example/alice/data/access-grants/1";
const DATA_GRANT = "https://pod.example/alice/data/data-grants/1";
const SHAPE_TREE = "https://shapes.example/recommendation-profile";

const RECORD: RecommendationProfileStoreRecord = Object.freeze({
  schemaVersion: "recommendation-profile-store-record.v1",
  subjectKey: SUBJECT_KEY,
  writtenAt: NOW,
  profile: Object.freeze({
    schemaVersion: "recommendation-profile.v1",
    updatedAt: NOW,
    signalCount: 0,
    entries: Object.freeze([])
  })
});

function grant(
  overrides: Partial<RecommendationActivityPodsResourceGrantEvidenceInput> = {}
): RecommendationActivityPodsResourceGrantEvidenceInput {
  return {
    subjectId: "subject-1",
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    dataGrantUri: DATA_GRANT,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    containerUri: CONTAINER,
    resourceUri: RESOURCE,
    shapeTreeUri: SHAPE_TREE,
    resourceAccessModes: ["read", "write"],
    containerAccessModes: ["read", "write"],
    checkedAt: "2026-08-05T11:59:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
    providerPolicyAllowsProcessing: true,
    ...overrides
  };
}

test("rejects leap-second grant timestamps before temporal comparisons", () => {
  for (const [patch, options] of [
    [{ checkedAt: "2026-08-05T11:59:60Z" }, { now: NOW }],
    [{ expiresAt: "2030-01-01T00:00:60Z" }, { now: NOW }],
    [{}, { now: "2026-08-05T11:59:60Z" }]
  ] as const) {
    assert.throws(
      () => normalizeRecommendationActivityPodsResourceGrantEvidence(grant(patch), options),
      TypeError
    );
  }
});

test("weak ETags remain usable for reads but cannot drive If-Match mutations", async () => {
  let writes = 0;
  let deletes = 0;
  const adapter = createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: "subject-1",
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    dataGrantUri: DATA_GRANT,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    profileContainerUri: CONTAINER,
    shapeTreeUri: SHAPE_TREE,
    now: () => NOW,
    authorize: () => grant(),
    codec: {
      encode: (record) => ({ encoded: record }),
      decode(document) {
        return (document as { encoded: unknown }).encoded;
      }
    },
    transport: {
      read: () => ({ status: "found", document: { encoded: RECORD }, entityTag: "W/\"v1\"" }),
      write: () => {
        writes += 1;
        return { status: "written", entityTag: "\"v2\"" };
      },
      delete: () => {
        deletes += 1;
        return { status: "deleted" };
      }
    }
  });

  const read = await adapter.readProfileRecord(SUBJECT_KEY) as RecommendationProfileStoreRecord;
  assert.equal(read.subjectKey, SUBJECT_KEY);
  assert.equal(read.profile.signalCount, 0);
  await assert.rejects(adapter.writeProfileRecord(RECORD), /strong entity tag/u);
  await assert.rejects(adapter.deleteProfileRecord(SUBJECT_KEY), /strong entity tag/u);
  assert.equal(writes, 0);
  assert.equal(deletes, 0);
});
