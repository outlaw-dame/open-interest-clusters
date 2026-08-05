import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRecommendationActivityPodsResourceGrantEvidence,
  requireRecommendationActivityPodsResourceOperation,
  type RecommendationActivityPodsResourceGrantEvidenceInput
} from "../src/recommendation/activitypods-resource-authorization.js";

const NOW = "2026-08-05T12:00:00Z";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const STORAGE = "https://pod.example/alice/data/";
const CONTAINER = "https://pod.example/alice/data/recommendation-profiles/";
const RESOURCE = `${CONTAINER}profile%3A0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.jsonld`;
const REGISTRATION = "https://pod.example/alice/data/application-registrations/1";
const ACCESS_GRANT = "https://pod.example/alice/data/access-grants/1";
const DATA_GRANT = "https://pod.example/alice/data/data-grants/1";
const SHAPE_TREE = "https://shapes.example/recommendation-profile";

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

test("normalizes and freezes ActivityPods application, grant, storage, and access-need evidence", () => {
  const evidence = normalizeRecommendationActivityPodsResourceGrantEvidence(grant(), { now: NOW });
  assert.equal(evidence.ownerActorUri, evidence.ownerWebId);
  assert.equal(evidence.applicationRegistrationUri, REGISTRATION);
  assert.equal(evidence.accessGrantUri, ACCESS_GRANT);
  assert.equal(evidence.dataGrantUri, DATA_GRANT);
  assert.equal(evidence.shapeTreeUri, SHAPE_TREE);
  assert.deepEqual(evidence.resourceAccessModes, ["read", "write"]);
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.resourceAccessModes));
});

test("binds registration, grants, storage, container, and resource to the owner Pod authority", () => {
  for (const invalid of [
    grant({ ownerWebId: "https://pod.example/alice#me" }),
    grant({ applicationActorUri: OWNER }),
    grant({ applicationRegistrationUri: "https://evil.example/registration/1" }),
    grant({ accessGrantUri: "https://evil.example/access-grant/1" }),
    grant({ dataGrantUri: "https://evil.example/data-grant/1" }),
    grant({ storageRootUri: "https://storage.example/alice/data/" }),
    grant({ containerUri: "https://pod.example/alice/private/" }),
    grant({ resourceUri: "https://pod.example/alice/data/other/profile.jsonld" })
  ]) {
    assert.throws(
      () => normalizeRecommendationActivityPodsResourceGrantEvidence(invalid, { now: NOW }),
      /ActivityPods/u
    );
  }
});

test("rejects revoked, expired, future-dated, duplicate, unknown, and provider-denied grants", () => {
  for (const invalid of [
    grant({ revokedAt: "2026-08-05T11:59:30Z" }),
    grant({ expiresAt: "2026-08-05T11:59:59Z" }),
    grant({ checkedAt: "2026-08-05T12:01:00Z" }),
    grant({ resourceAccessModes: ["read", "read"] }),
    grant({ resourceAccessModes: ["unknown"] }),
    grant({ providerPolicyAllowsProcessing: false })
  ]) {
    assert.throws(
      () => requireRecommendationActivityPodsResourceOperation(invalid, "read", { now: NOW }),
      /ActivityPods/u
    );
  }
});

test("read requires resource read, and conditional writes require resource read/write plus container write", () => {
  assert.doesNotThrow(() =>
    requireRecommendationActivityPodsResourceOperation(grant(), "read", { now: NOW })
  );
  assert.doesNotThrow(() =>
    requireRecommendationActivityPodsResourceOperation(grant(), "write", { now: NOW })
  );

  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(
      grant({ resourceAccessModes: ["write"] }),
      "write",
      { now: NOW }
    ),
    /read and write/u
  );
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(
      grant({ containerAccessModes: ["read"] }),
      "write",
      { now: NOW }
    ),
    /profile container/u
  );
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(
      grant({ resourceAccessModes: ["write"] }),
      "read",
      { now: NOW }
    ),
    /does not allow read/u
  );
});

test("delete requires resource read/write and containing-container write access", () => {
  assert.doesNotThrow(() =>
    requireRecommendationActivityPodsResourceOperation(grant(), "delete", { now: NOW })
  );
  for (const invalid of [
    grant({ resourceAccessModes: ["read"] }),
    grant({ resourceAccessModes: ["write"] }),
    grant({ containerAccessModes: ["read"] })
  ]) {
    assert.throws(
      () => requireRecommendationActivityPodsResourceOperation(invalid, "delete", { now: NOW }),
      /deletion requires/u
    );
  }
});

test("owner evidence can authorize operations but remains subject to lifecycle and provider policy", () => {
  assert.doesNotThrow(() =>
    requireRecommendationActivityPodsResourceOperation(
      grant({
        isOwner: true,
        resourceAccessModes: ["none"],
        containerAccessModes: ["none"]
      }),
      "delete",
      { now: NOW }
    )
  );
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(
      grant({
        isOwner: true,
        resourceAccessModes: ["none"],
        containerAccessModes: ["none"],
        providerPolicyAllowsProcessing: false
      }),
      "read",
      { now: NOW }
    ),
    /provider policy/u
  );
});

test("unsafe local-network and credential-bearing URLs fail closed", () => {
  for (const invalid of [
    grant({ resourceUri: "https://127.0.0.1/profile.jsonld" }),
    grant({ ownerActorUri: "https://localhost/alice", ownerWebId: "https://localhost/alice" }),
    grant({ applicationActorUri: "https://user:pass@app.example/application" }),
    grant({ shapeTreeUri: "http://shapes.example/recommendation-profile" })
  ]) {
    assert.throws(
      () => normalizeRecommendationActivityPodsResourceGrantEvidence(invalid, { now: NOW }),
      /ActivityPods/u
    );
  }
});
