import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_DERIVED_DATA_TARGETS,
  createRecommendationDerivedDataDeletionIntent,
  evaluateRecommendationConsent,
  markRecommendationConsentForDeletion,
  type RecommendationConsentPolicy,
  type RecommendationConsentRequest
} from "../src/index.js";

const subjectId = "did:web:alice.example";
const basePolicy: RecommendationConsentPolicy = {
  subjectId,
  allowedDataUses: ["ranking", "local_personalization", "embeddings"]
};

const baseRequest: RecommendationConsentRequest = {
  subjectId,
  dataUse: "ranking",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web"
};

test("recommendation consent denies by default without an explicit policy", () => {
  const decision = evaluateRecommendationConsent(undefined, baseRequest);

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reason, "consent.deny.default");
});

test("recommendation consent permits only explicitly allowed data uses", () => {
  const allowed = evaluateRecommendationConsent(basePolicy, baseRequest);
  const denied = evaluateRecommendationConsent(basePolicy, {
    ...baseRequest,
    dataUse: "analytics"
  });

  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.reason, "consent.allow.explicit");
  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, "consent.deny.use_not_allowed");
});

test("revoked recommendation consent blocks every data use", () => {
  const decision = evaluateRecommendationConsent(
    {
      ...basePolicy,
      revokedAt: "2026-05-15T00:00:00.000Z"
    },
    baseRequest
  );

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reason, "consent.deny.revoked");
});

test("delete-derived-data request blocks further recommendation processing", () => {
  const policy = markRecommendationConsentForDeletion(basePolicy, "2026-05-15T00:00:00.000Z");
  const decision = evaluateRecommendationConsent(policy, baseRequest);

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reason, "consent.deny.deleted");
});

test("delete-derived-data intent covers derived profile state and histories", () => {
  const intent = createRecommendationDerivedDataDeletionIntent(subjectId, "2026-05-15T00:00:00.000Z");

  assert.equal(intent.scope, "recommendation_derived_data");
  assert.deepEqual(intent.targets, RECOMMENDATION_DERIVED_DATA_TARGETS);
  assert.ok(intent.targets.includes("profile"));
  assert.ok(intent.targets.includes("embeddings"));
  assert.ok(intent.targets.includes("source_references"));
  assert.ok(intent.targets.includes("event_history"));
});

test("server-side processing requires explicit server-side consent", () => {
  const denied = evaluateRecommendationConsent(basePolicy, {
    ...baseRequest,
    dataUse: "local_personalization",
    serverSideProcessing: true
  });
  const allowed = evaluateRecommendationConsent(
    {
      ...basePolicy,
      serverSideDataUses: ["local_personalization"]
    },
    {
      ...baseRequest,
      dataUse: "local_personalization",
      serverSideProcessing: true
    }
  );

  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, "consent.deny.server_processing_not_allowed");
  assert.equal(allowed.decision, "allow");
});

test("followers-only and direct-like data require matching access and private-data consent", () => {
  const noAccess = evaluateRecommendationConsent(basePolicy, {
    ...baseRequest,
    sourceVisibility: "followers_only",
    accessBasis: "public_web"
  });
  const noPrivateConsent = evaluateRecommendationConsent(basePolicy, {
    ...baseRequest,
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship"
  });
  const allowed = evaluateRecommendationConsent(
    {
      ...basePolicy,
      privateDataUses: ["ranking"]
    },
    {
      ...baseRequest,
      sourceVisibility: "followers_only",
      accessBasis: "follower_relationship"
    }
  );

  assert.equal(noAccess.decision, "deny");
  assert.equal(noAccess.reason, "access.deny.visibility_scope");
  assert.equal(noPrivateConsent.decision, "deny");
  assert.equal(noPrivateConsent.reason, "safety.deny.private_data_use_not_allowed");
  assert.equal(allowed.decision, "allow");
});

test("ACL-controlled ActivityPods data requires Solid ACL access basis", () => {
  const denied = evaluateRecommendationConsent(
    {
      ...basePolicy,
      privateDataUses: ["ranking"]
    },
    {
      ...baseRequest,
      protocol: "activitypods",
      sourceVisibility: "acl_controlled",
      accessBasis: "authenticated_api"
    }
  );
  const allowed = evaluateRecommendationConsent(
    {
      ...basePolicy,
      privateDataUses: ["ranking"]
    },
    {
      ...baseRequest,
      protocol: "activitypods",
      sourceVisibility: "acl_controlled",
      accessBasis: "solid_acl_read"
    }
  );

  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, "access.deny.acl_required");
  assert.equal(allowed.decision, "allow");
});

test("ATProto public repo data is public-source but still requires user consent", () => {
  const request: RecommendationConsentRequest = {
    ...baseRequest,
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo"
  };

  const denied = evaluateRecommendationConsent(undefined, request);
  const allowed = evaluateRecommendationConsent(basePolicy, request);

  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, "consent.deny.default");
  assert.equal(allowed.decision, "allow");
});

test("third-party private data requires separate explicit consent", () => {
  const request: RecommendationConsentRequest = {
    ...baseRequest,
    sourceVisibility: "mentioned_only",
    accessBasis: "mentioned_recipient",
    containsThirdPartyData: true
  };

  const denied = evaluateRecommendationConsent(
    {
      ...basePolicy,
      privateDataUses: ["ranking"]
    },
    request
  );
  const allowed = evaluateRecommendationConsent(
    {
      ...basePolicy,
      privateDataUses: ["ranking"],
      thirdPartyPrivateDataUses: ["ranking"]
    },
    request
  );

  assert.equal(denied.decision, "deny");
  assert.equal(denied.reason, "safety.deny.third_party_private_data");
  assert.equal(allowed.decision, "allow");
});

test("consent audit events never expose raw subject identifiers", () => {
  const decision = evaluateRecommendationConsent(basePolicy, baseRequest);
  const serialized = JSON.stringify(decision);

  assert.equal(decision.auditEvent.reason, "consent.allow.explicit");
  assert.equal(Object.isFrozen(decision.auditEvent), true);
  assert.equal(serialized.includes(subjectId), false);
  assert.equal(serialized.includes("alice.example"), false);
});
