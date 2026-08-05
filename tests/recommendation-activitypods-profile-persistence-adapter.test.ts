import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationActivityPodsProfileConflictError,
  createRecommendationActivityPodsProfilePersistenceAdapter,
  type RecommendationActivityPodsProfileTransportReadResult,
  type RecommendationActivityPodsProfileTransportWriteRequest
} from "../src/recommendation/activitypods-profile-persistence-adapter.js";
import type { RecommendationActivityPodsResourceGrantEvidenceInput } from "../src/recommendation/activitypods-resource-authorization.js";
import type { RecommendationProfileStoreRecord } from "../src/recommendation/profile-store-persistence.js";

const SUBJECT = "subject-1";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const STORAGE = "https://pod.example/alice/data/";
const CONTAINER = "https://pod.example/alice/data/recommendation-profiles/";
const REGISTRATION = "https://pod.example/alice/data/application-registrations/1";
const ACCESS_GRANT = "https://pod.example/alice/data/access-grants/1";
const DATA_GRANT = "https://pod.example/alice/data/data-grants/1";
const SHAPE_TREE = "https://shapes.example/recommendation-profile";
const CONTEXT = "https://contexts.example/recommendation-profile-v1.jsonld";
const NOW = "2026-08-05T12:00:00Z";
const SUBJECT_KEY = `profile:${"a".repeat(64)}`;
const RESOURCE = `${CONTAINER}${encodeURIComponent(SUBJECT_KEY)}.jsonld`;

const RECORD: RecommendationProfileStoreRecord = {
  schemaVersion: "recommendation-profile-store-record.v1",
  subjectKey: SUBJECT_KEY,
  writtenAt: NOW,
  profile: {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: NOW,
    signalCount: 3,
    entries: [
      {
        target: { kind: "keyword", key: "lower-score" },
        score: 0.2,
        confidence: 0.6,
        signalCount: 1,
        positiveSignalCount: 1,
        negativeSignalCount: 0,
        neutralSignalCount: 0,
        privacyBoundaries: ["server_allowed", "server_allowed"],
        protocols: ["activitypods", "activitypub", "activitypods"],
        sourceVisibilities: ["public", "public"],
        updatedAt: NOW
      },
      {
        target: { kind: "keyword", key: "higher-score" },
        score: 0.9,
        confidence: 0.8,
        signalCount: 2,
        positiveSignalCount: 2,
        negativeSignalCount: 0,
        neutralSignalCount: 0,
        privacyBoundaries: ["server_allowed"],
        protocols: ["activitypods"],
        sourceVisibilities: ["public"],
        updatedAt: NOW
      }
    ]
  }
};

function grant(
  resourceUri = RESOURCE,
  overrides: Partial<RecommendationActivityPodsResourceGrantEvidenceInput> = {}
): RecommendationActivityPodsResourceGrantEvidenceInput {
  return {
    subjectId: SUBJECT,
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    dataGrantUri: DATA_GRANT,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    containerUri: CONTAINER,
    resourceUri,
    shapeTreeUri: SHAPE_TREE,
    resourceAccessModes: ["read", "write"],
    containerAccessModes: ["read", "write"],
    checkedAt: "2026-08-05T11:59:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
    providerPolicyAllowsProcessing: true,
    ...overrides
  };
}

function createAdapter(overrides: {
  read?: () => RecommendationActivityPodsProfileTransportReadResult;
  authorize?: (
    operation: "read" | "write" | "delete",
    resourceUri: string,
    subjectKey: string
  ) => RecommendationActivityPodsResourceGrantEvidenceInput;
  onWrite?: (request: RecommendationActivityPodsProfileTransportWriteRequest) =>
    | { status: "written"; entityTag: string }
    | { status: "precondition_failed" };
  onDelete?: (condition: unknown) =>
    | { status: "deleted" }
    | { status: "not_found" }
    | { status: "precondition_failed" };
  encoded?: unknown[];
  calls?: string[];
  jsonLdContext?: string;
}) {
  const calls = overrides.calls ?? [];
  return createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: SUBJECT,
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    dataGrantUri: DATA_GRANT,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    profileContainerUri: CONTAINER,
    shapeTreeUri: SHAPE_TREE,
    jsonLdContext: overrides.jsonLdContext ?? CONTEXT,
    now: () => NOW,
    authorize(operation, resourceUri, subjectKey) {
      calls.push(`authorize:${operation}:${subjectKey}`);
      return overrides.authorize?.(operation, resourceUri, subjectKey) ?? grant(resourceUri);
    },
    codec: {
      encode(record) {
        overrides.encoded?.push(record);
        return { encoded: record };
      },
      decode(document) {
        if (!document || typeof document !== "object" || !("encoded" in document)) {
          throw new TypeError("Invalid test profile document.");
        }
        return (document as { encoded: unknown }).encoded;
      }
    },
    transport: {
      read(request) {
        calls.push(`read:${request.resourceUri}:${request.mediaType}:${request.jsonLdContext ?? ""}`);
        assert.equal(request.applicationActorUri, APP);
        assert.equal(request.ownerWebId, OWNER);
        assert.equal(request.applicationRegistrationUri, REGISTRATION);
        assert.equal(request.accessGrantUri, ACCESS_GRANT);
        assert.equal(request.dataGrantUri, DATA_GRANT);
        assert.equal(request.shapeTreeUri, SHAPE_TREE);
        return overrides.read?.() ?? { status: "found", document: { encoded: RECORD }, entityTag: "\"v1\"" };
      },
      write(request) {
        calls.push(`write:${request.resourceUri}`);
        return overrides.onWrite?.(request) ?? { status: "written", entityTag: "\"v2\"" };
      },
      delete(request) {
        calls.push(`delete:${request.resourceUri}`);
        return overrides.onDelete?.(request.condition) ?? { status: "deleted" };
      }
    }
  });
}

test("reads one grant-bound JSON-LD profile resource and normalizes the decoded record", async () => {
  const calls: string[] = [];
  const adapter = createAdapter({ calls });
  const result = await adapter.readProfileRecord(SUBJECT_KEY) as RecommendationProfileStoreRecord;

  assert.equal(result.subjectKey, SUBJECT_KEY);
  assert.equal(result.profile.entries[0]?.target.key, "higher-score");
  assert.deepEqual(result.profile.entries[1]?.protocols, ["activitypods", "activitypub"]);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(calls, [
    `authorize:read:${SUBJECT_KEY}`,
    `read:${RESOURCE}:application/ld+json:${CONTEXT}`
  ]);
});

test("returns null for a missing Pod profile without invoking the decoder", async () => {
  let decoded = 0;
  const adapter = createRecommendationActivityPodsProfilePersistenceAdapter({
    subjectId: SUBJECT,
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
    authorize: (_operation, resourceUri) => grant(resourceUri),
    codec: {
      encode: (record) => ({ record }),
      decode: (document) => {
        decoded += 1;
        return document;
      }
    },
    transport: {
      read: () => ({ status: "not_found" }),
      write: () => ({ status: "written", entityTag: "\"v1\"" }),
      delete: () => ({ status: "deleted" })
    }
  });

  assert.equal(await adapter.readProfileRecord(SUBJECT_KEY), null);
  assert.equal(decoded, 0);
});

test("normalizes profile snapshots before encoding and uses If-Match for updates", async () => {
  const encoded: unknown[] = [];
  let writeRequest: RecommendationActivityPodsProfileTransportWriteRequest | undefined;
  const adapter = createAdapter({
    encoded,
    onWrite(request) {
      writeRequest = request;
      return { status: "written", entityTag: "\"v2\"" };
    }
  });

  const written = await adapter.writeProfileRecord(RECORD);
  assert.deepEqual(writeRequest?.condition, { kind: "if_match", entityTag: "\"v1\"" });
  const normalized = encoded[0] as RecommendationProfileStoreRecord;
  assert.equal(normalized.profile.entries[0]?.target.key, "higher-score");
  assert.deepEqual(normalized.profile.entries[1]?.protocols, ["activitypods", "activitypub"]);
  assert.ok(Object.isFrozen(normalized));
  assert.deepEqual(written, normalized);
});

test("uses If-None-Match for first writes and fails safely on concurrent creation", async () => {
  let condition: unknown;
  const createAdapterInstance = createAdapter({
    read: () => ({ status: "not_found" }),
    onWrite(request) {
      condition = request.condition;
      return { status: "written", entityTag: "\"v1\"" };
    }
  });
  await createAdapterInstance.writeProfileRecord(RECORD);
  assert.deepEqual(condition, { kind: "if_none_match", value: "*" });

  const conflict = createAdapter({
    read: () => ({ status: "not_found" }),
    onWrite: () => ({ status: "precondition_failed" })
  });
  await assert.rejects(
    conflict.writeProfileRecord(RECORD),
    (error) => error instanceof RecommendationActivityPodsProfileConflictError &&
      error.code === "activitypods_profile_conflict"
  );
});

test("deletes with the current entity tag, treats already-missing resources as deleted, and surfaces conflicts", async () => {
  let condition: unknown;
  const adapter = createAdapter({
    onDelete(value) {
      condition = value;
      return { status: "deleted" };
    }
  });
  await adapter.deleteProfileRecord(SUBJECT_KEY);
  assert.deepEqual(condition, { kind: "if_match", entityTag: "\"v1\"" });

  let deleteCalls = 0;
  const missing = createAdapter({
    read: () => ({ status: "not_found" }),
    onDelete() {
      deleteCalls += 1;
      return { status: "deleted" };
    }
  });
  await missing.deleteProfileRecord(SUBJECT_KEY);
  assert.equal(deleteCalls, 0);

  const conflict = createAdapter({ onDelete: () => ({ status: "precondition_failed" }) });
  await assert.rejects(
    conflict.deleteProfileRecord(SUBJECT_KEY),
    RecommendationActivityPodsProfileConflictError
  );
});

test("authorization and all identity/grant bindings are checked before profile transport", async () => {
  const variants: Partial<RecommendationActivityPodsResourceGrantEvidenceInput>[] = [
    { subjectId: "other-subject" },
    { applicationActorUri: "https://other-app.example/application" },
    { applicationRegistrationUri: "https://pod.example/alice/data/application-registrations/2" },
    { accessGrantUri: "https://pod.example/alice/data/access-grants/2" },
    { dataGrantUri: "https://pod.example/alice/data/data-grants/2" },
    { ownerActorUri: "https://pod.example/bob", ownerWebId: "https://pod.example/bob" },
    { shapeTreeUri: "https://shapes.example/other" }
  ];

  for (const patch of variants) {
    let reads = 0;
    const adapter = createAdapter({
      authorize: (_operation, resourceUri) => grant(resourceUri, patch),
      read() {
        reads += 1;
        return { status: "not_found" };
      }
    });
    await assert.rejects(adapter.readProfileRecord(SUBJECT_KEY), /ActivityPods profile grant/u);
    assert.equal(reads, 0);
  }
});

test("write and delete require conditional-update WAC modes before transport", async () => {
  for (const [operation, patch, error] of [
    ["writeProfileRecord", { resourceAccessModes: ["write"] }, /read and write/u],
    ["writeProfileRecord", { containerAccessModes: ["read"] }, /profile container/u],
    ["deleteProfileRecord", { resourceAccessModes: ["read"] }, /deletion requires/u],
    ["deleteProfileRecord", { containerAccessModes: ["read"] }, /deletion requires/u]
  ] as const) {
    let reads = 0;
    const adapter = createAdapter({
      authorize: (_requestedOperation, resourceUri) => grant(resourceUri, patch),
      read() {
        reads += 1;
        return { status: "not_found" };
      }
    });
    const action = operation === "writeProfileRecord"
      ? adapter.writeProfileRecord(RECORD)
      : adapter.deleteProfileRecord(SUBJECT_KEY);
    await assert.rejects(action, error);
    assert.equal(reads, 0);
  }
});

test("supports URL and serialized JSON JsonLdContext headers", async () => {
  const contexts = [
    CONTEXT,
    JSON.stringify({ rec: "https://example.org/recommendation#" }),
    JSON.stringify(["https://www.w3.org/ns/activitystreams", { rec: "https://example.org/recommendation#" }])
  ];
  for (const context of contexts) {
    const calls: string[] = [];
    const adapter = createAdapter({ calls, jsonLdContext: context });
    await adapter.readProfileRecord(SUBJECT_KEY);
    assert.ok(calls[1]?.endsWith(context));
  }
});

test("rejects malformed records, entity tags, contexts, subject keys, and Pod boundaries", async () => {
  const malformedRead = createAdapter({
    read: () => ({ status: "found", document: { encoded: RECORD }, entityTag: "not-an-etag" })
  });
  await assert.rejects(malformedRead.readProfileRecord(SUBJECT_KEY), /entity tag/u);

  await assert.rejects(
    createAdapter({
      read: () => ({
        status: "found",
        entityTag: "\"v1\"",
        document: { encoded: { ...RECORD, subjectKey: `profile:${"b".repeat(64)}` } }
      })
    }).readProfileRecord(SUBJECT_KEY),
    /subject key mismatch/u
  );

  await assert.rejects(
    createAdapter({}).readProfileRecord("../escape"),
    /subject key/u
  );

  const base = {
    subjectId: SUBJECT,
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    dataGrantUri: DATA_GRANT,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    storageRootUri: STORAGE,
    shapeTreeUri: SHAPE_TREE,
    now: () => NOW,
    authorize: (_operation: "read" | "write" | "delete", resourceUri: string) => grant(resourceUri),
    codec: { encode: (record: RecommendationProfileStoreRecord) => ({ record }), decode: (document: unknown) => document },
    transport: {
      read: () => ({ status: "not_found" as const }),
      write: () => ({ status: "written" as const, entityTag: "\"v1\"" }),
      delete: () => ({ status: "deleted" as const })
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
      profileContainerUri: CONTAINER,
      jsonLdContext: "not-json-or-url"
    }),
    /JSON-LD context/u
  );
  assert.throws(
    () => createRecommendationActivityPodsProfilePersistenceAdapter({
      ...base,
      profileContainerUri: "https://127.0.0.1/recommendation/"
    }),
    /container URI/u
  );
});
