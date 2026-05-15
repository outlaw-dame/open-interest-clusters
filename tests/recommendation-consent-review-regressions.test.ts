import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecommendationConsent,
  markRecommendationConsentForDeletion,
  type RecommendationConsentPolicy,
  type RecommendationConsentRequest
} from "../src/index.js";

const subjectId = "subject-1";
const policy: RecommendationConsentPolicy = {
  subjectId,
  allowedDataUses: ["ranking"]
};
const request: RecommendationConsentRequest = {
  subjectId,
  dataUse: "ranking",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web"
};

test("public and unlisted visibility allow non-public-web access bases except unknown", () => {
  const publicViaRelationship = evaluateRecommendationConsent(policy, {
    ...request,
    sourceVisibility: "public",
    accessBasis: "follower_relationship"
  });
  const unlistedViaPublicWeb = evaluateRecommendationConsent(policy, {
    ...request,
    sourceVisibility: "unlisted",
    accessBasis: "public_web"
  });
  const unknownDenied = evaluateRecommendationConsent(policy, {
    ...request,
    sourceVisibility: "public",
    accessBasis: "unknown"
  });

  assert.equal(publicViaRelationship.decision, "allow");
  assert.equal(unlistedViaPublicWeb.decision, "allow");
  assert.equal(unknownDenied.decision, "deny");
  assert.equal(unknownDenied.reason, "access.deny.access_basis_unknown");
});

test("mutual relationship access satisfies followers-only visibility", () => {
  const decision = evaluateRecommendationConsent(
    {
      ...policy,
      privateDataUses: ["ranking"]
    },
    {
      ...request,
      sourceVisibility: "followers_only",
      accessBasis: "mutual_relationship"
    }
  );

  assert.equal(decision.decision, "allow");
});

test("audit event reflects visibility-derived restricted source status", () => {
  const decision = evaluateRecommendationConsent(policy, {
    ...request,
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship"
  });

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reason, "safety.deny.private_data_use_not_allowed");
  assert.equal(decision.containsPrivateData, true);
  assert.equal(decision.auditEvent.containsPrivateData, true);
});

test("deletion helper safely rejects invalid runtime policy values", () => {
  assert.throws(
    () => markRecommendationConsentForDeletion(null as unknown as RecommendationConsentPolicy, "2026-05-15T00:00:00.000Z"),
    TypeError
  );
});
