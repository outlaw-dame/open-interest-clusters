import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationActivityPodsBoxReadAuthorization,
  normalizeRecommendationActivityPodsBoxGrantEvidence,
  normalizeRecommendationActivityPodsResourceGrantEvidence,
  requireRecommendationActivityPodsResourceOperation
} from "../src/recommendation/activitypods-authorization.js";

const NOW = "2026-08-05T02:00:00Z";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const OUTBOX = "https://pod.example/alice/outbox";
const PROFILE = "https://pod.example/alice/data/recommendation/profile.jsonld";

function boxGrant() {
  return {
    subjectId: "subject-1",
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    boxType: "outbox" as const,
    boxUri: OUTBOX,
    rights: ["apods:ReadOutbox"] as const,
    checkedAt: "2026-08-05T01:59:00Z",
    expiresAt: "2026-08-05T03:00:00Z",
    providerPolicyAllowsProcessing: true
  };
}

function resourceGrant() {
  return {
    subjectId: "subject-1",
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    resourceUri: PROFILE,
    accessModes: ["read", "write"] as const,
    checkedAt: "2026-08-05T01:59:00Z",
    expiresAt: "2026-08-05T03:00:00Z",
    providerPolicyAllowsProcessing: true
  };
}

test("normalizes ActivityPods outbox rights and produces private box-read authorization evidence", () => {
  const evidence = normalizeRecommendationActivityPodsBoxGrantEvidence(boxGrant(), { now: NOW });
  assert.equal(evidence.requiredRight, "apods:ReadOutbox");
  assert.equal(evidence.ownerActorUri, evidence.ownerWebId);
  assert.ok(Object.isFrozen(evidence));

  const authorization = createRecommendationActivityPodsBoxReadAuthorization(evidence);
  assert.equal(authorization.sourceVisibility, "acl_controlled");
  assert.equal(authorization.accessBasis, "solid_acl_read");
  assert.equal(authorization.containsPrivateData, true);
  assert.equal(authorization.containsThirdPartyData, true);
});

test("requires the special right matching the configured box", () => {
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      rights: ["apods:ReadInbox"]
    }),
    /lacks apods:ReadOutbox/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      boxType: "inbox",
      boxUri: "https://pod.example/alice/inbox",
      rights: ["apods:ReadOutbox"]
    }),
    /lacks apods:ReadInbox/u
  );
});

test("binds the owner actor, WebID, and box to one Pod authority", () => {
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      ownerWebId: "https://pod.example/alice#me"
    }),
    /must equal/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      boxUri: "https://evil.example/alice/outbox"
    }),
    /owner Pod authority/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      applicationActorUri: OWNER
    }),
    /distinct/u
  );
});

test("rejects revoked, expired, future-dated, duplicate, and unsafe grants", () => {
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      revokedAt: "2026-08-05T01:59:30Z"
    }, { now: NOW }),
    /revoked/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      expiresAt: "2026-08-05T01:59:59Z"
    }, { now: NOW }),
    /expired/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      checkedAt: "2026-08-05T02:01:00Z"
    }, { now: NOW }),
    /future/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      rights: ["apods:ReadOutbox", "apods:ReadOutbox"]
    }),
    /special rights/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      boxUri: "https://127.0.0.1/outbox"
    }),
    /box URI/u
  );
});

test("uses the current time by default so stale grants cannot authorize reads", () => {
  assert.throws(
    () => normalizeRecommendationActivityPodsBoxGrantEvidence({
      ...boxGrant(),
      checkedAt: "2020-01-01T00:00:00Z",
      expiresAt: "2020-01-01T01:00:00Z"
    }),
    /expired/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsResourceGrantEvidence({
      ...resourceGrant(),
      checkedAt: "2020-01-01T00:00:00Z",
      expiresAt: "2020-01-01T01:00:00Z"
    }),
    /expired/u
  );
});

test("resource grants enforce read versus mutation access without inventing a new consent access basis", () => {
  const evidence = normalizeRecommendationActivityPodsResourceGrantEvidence(resourceGrant(), { now: NOW });
  assert.deepEqual(requireRecommendationActivityPodsResourceOperation(evidence, "read"), evidence);
  assert.deepEqual(requireRecommendationActivityPodsResourceOperation(evidence, "write"), evidence);
  assert.deepEqual(requireRecommendationActivityPodsResourceOperation(evidence, "delete"), evidence);

  const readOnly = normalizeRecommendationActivityPodsResourceGrantEvidence({
    ...resourceGrant(),
    accessModes: ["read"]
  });
  assert.deepEqual(requireRecommendationActivityPodsResourceOperation(readOnly, "read"), readOnly);
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(readOnly, "write"),
    /does not allow write/u
  );
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(readOnly, "delete"),
    /does not allow delete/u
  );
});

test("owner grants may perform resource operations but provider policy still fails closed", () => {
  const ownerGrant = normalizeRecommendationActivityPodsResourceGrantEvidence({
    ...resourceGrant(),
    accessModes: ["none"],
    isOwner: true
  });
  assert.deepEqual(requireRecommendationActivityPodsResourceOperation(ownerGrant, "delete"), ownerGrant);

  const denied = normalizeRecommendationActivityPodsResourceGrantEvidence({
    ...resourceGrant(),
    providerPolicyAllowsProcessing: false
  });
  assert.throws(
    () => requireRecommendationActivityPodsResourceOperation(denied, "read"),
    /provider policy/u
  );
});
