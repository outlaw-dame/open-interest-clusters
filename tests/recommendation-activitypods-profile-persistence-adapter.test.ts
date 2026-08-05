import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationActivityPodsProfilePersistenceAdapter,
  type RecommendationActivityPodsProfileTransportReadResult
} from "../src/recommendation/activitypods-profile-persistence-adapter.js";
import type { RecommendationProfileStoreRecord } from "../src/recommendation/profile-store-persistence.js";

const SUBJECT = "subject-1";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const STORAGE = "https://pod.example/alice/data/";
const CONTAINER = "https://pod.example/alice/data/recommendation-profiles/";
const CONTEXT = "https://example.org/contexts/recommendation-profile-v1.jsonld";
const NOW = "2026-08-05T02:00:00Z";
const SUBJECT_KEY = "profile-key-1";

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

function grant(resourceUri: string, accessModes: readonly ("read" | "write" | "control")[]) {
  return {
    subjectId: SUBJECT,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    resourceUri,
    accessModes,
    checkedAt: NOW,
    providerPolicyAllowsProcessing: true
  };
}

function adapter(overrides: {
  read?: (resourceUri: string) => RecommendationActivityPodsProfileTransportReadResult;
  authorize?: (operation: "read" | "write" | "delete", resourceUri: string) => ReturnType<typeof grant>;
  calls?: string[];
} = {}) {
  const calls = overrides.calls ?? [];
  return createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: SUBJECT,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    profileContainerUri: CONTAINER,
    jsonLdContext: CONTEXT,
    authorize: (operation, resourceUri) => overrides.authorize?.(operation, resourceUri) ?? grant(resourceUri, ["read", "write"]),
    codec: {
      encode(record) {
        return { encoded: record };
      },
      decode(document) {
        if (typeof document !== "object" || document === null || !("encoded" in document)) {
          throw new TypeError("Invalid test ActivityPods profile document.");
        }
        return (document as { encoded: unknown }).encoded;
      }
    },
    transport: {
      read(request) {
        calls.push(`read:${request.resourceUri}:${request.mediaType}:${request.jsonLdContext ?? ""}`);
        return overrides.read?.(request.resourceUri) ?? { status: "found", document: { encoded: RECORD } };
      },
      write(request) {
        calls.push(`write:${request.resourceUri}:${request.mediaType}:${request.jsonLdContext ?? ""}`);
        assert.deepEqual(request.document, { encoded: RECORD });
      },
      delete(request) {
        calls.push(`delete:${request.resourceUri}:${request.mediaType}:${request.jsonLdContext ?? ""}`);
      }
    }
  });
}

test("reads, writes, and deletes profile records through one grant-checked Pod resource", async () => {
  const calls: string[] = [];
  const persistence = adapter({ calls });
  const expectedUri = `${CONTAINER}${SUBJECT_KEY}.jsonld`;

  assert.deepEqual(await persistence.readProfileRecord(SUBJECT_KEY), RECORD);
  await persistence.writeProfileRecord(RECORD);
  await persistence.deleteProfileRecord(SUBJECT_KEY);

  assert.deepEqual(calls, [
    `read:${expectedUri}:application/ld+json:${CONTEXT}`,
    `write:${expectedUri}:application/ld+json:${CONTEXT}`,
    `delete:${expectedUri}:application/ld+json:${CONTEXT}`
  ]);
});

test("returns null for a missing Pod profile without invoking the codec", async () => {
  let decoded = 0;
  const persistence = createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: SUBJECT,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    profileContainerUri: CONTAINER,
    authorize: (_operation, resourceUri) => grant(resourceUri, ["read", "write"]),
    codec: {
      encode: (record) => record,
      decode: (document) => {
        decoded += 1;
        return document;
      }
    },
    transport: {
      read: () => ({ status: "not_found" }),
      write: () => undefined,
      delete: () => undefined
    }
  });
  assert.equal(await persistence.readProfileRecord(SUBJECT_KEY), null);
  assert.equal(decoded, 0);
});

test("authorization is checked before every profile transport operation", async () => {
  const calls: string[] = [];
  const persistence = adapter({
    calls,
    authorize(operation, resourceUri) {
      return grant(resourceUri, operation === "read" ? ["read"] : ["read"]);
    }
  });

  assert.deepEqual(await persistence.readProfileRecord(SUBJECT_KEY), RECORD);
  await assert.rejects(persistence.writeProfileRecord(RECORD), /does not allow write/u);
  await assert.rejects(persistence.deleteProfileRecord(SUBJECT_KEY), /does not allow delete/u);
  assert.equal(calls.length, 1);
});

test("fails closed when a grant is for another subject, application, owner, or resource", async () => {
  const variants = [
    { subjectId: "other-subject" },
    { applicationActorUri: "https://other-app.example/application" },
    { ownerActorUri: "https://pod.example/bob", ownerWebId: "https://pod.example/bob" },
    { resourceUri: "https://pod.example/alice/data/other.jsonld" }
  ];
  for (const variant of variants) {
    let transportCalls = 0;
    const persistence = createRecommendationActivityPodsProfilePersistenceAdapter({
      subjectId: SUBJECT,
      applicationActorUri: APP,
      ownerActorUri: OWNER,
      ownerWebId: OWNER,
      storageRootUri: STORAGE,
      profileContainerUri: CONTAINER,
      authorize: (_operation, resourceUri) => ({
        ...grant(resourceUri, ["read", "write"]),
        ...variant
      }),
      codec: { encode: (record) => record, decode: (document) => document },
      transport: {
        read() {
          transportCalls += 1;
          return { status: "not_found" };
        },
        write() {
          transportCalls += 1;
        },
        delete() {
          transportCalls += 1;
        }
      }
    });
    await assert.rejects(persistence.readProfileRecord(SUBJECT_KEY), /grant does not match/u);
    assert.equal(transportCalls, 0);
  }
});

test("requires the profile container to remain inside the owner's Pod storage", () => {
  const base = {
    subjectId: SUBJECT,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    authorize: (_operation: "read" | "write" | "delete", resourceUri: string) => grant(resourceUri, ["read", "write"]),
    codec: { encode: (record: RecommendationProfileStoreRecord) => record, decode: (document: unknown) => document },
    transport: {
      read: () => ({ status: "not_found" as const }),
      write: () => undefined,
      delete: () => undefined
    }
  };

  assert.throws(
    () => createRecommendationActivityPodsProfilePersistenceAdapter({
      ...base,
      profileContainerUri: "https://pod.example/alice/private/"
    }),
    /within the owner storage root/u
  );
  assert.throws(
    () => createRecommendationActivityPodsProfilePersistenceAdapter({
      ...base,
      storageRootUri: "https://storage.example/alice/",
      profileContainerUri: "https://storage.example/alice/recommendation/"
    }),
    /owner Pod authority/u
  );
  assert.throws(
    () => createRecommendationActivityPodsProfilePersistenceAdapter({
      ...base,
      profileContainerUri: "https://127.0.0.1/recommendation/"
    }),
    /container URI/u
  );
});

test("rejects traversal-like subject keys before authorization or transport", async () => {
  let authorizations = 0;
  const persistence = createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: SUBJECT,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    profileContainerUri: CONTAINER,
    authorize: (_operation, resourceUri) => {
      authorizations += 1;
      return grant(resourceUri, ["read", "write"]);
    },
    codec: { encode: (record) => record, decode: (document) => document },
    transport: {
      read: () => ({ status: "not_found" }),
      write: () => undefined,
      delete: () => undefined
    }
  });

  for (const key of ["../escape", "folder/key", "folder\\key", ".", ".."] ) {
    await assert.rejects(persistence.readProfileRecord(key), /subject key/u);
  }
  assert.equal(authorizations, 0);
});
