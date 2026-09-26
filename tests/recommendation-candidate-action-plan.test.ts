import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  type RecommendationCandidate,
  type RecommendationCandidateEligibilityResult,
  type RecommendationCandidateKind
} from "../src/index.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";

function candidate(kind: RecommendationCandidateKind): RecommendationCandidate {
  const protocol = kind === "topic" ? "app_local" as const : "activitypub" as const;
  const nativeId = kind === "hashtag" ? "gaming" : `https://example.test/${kind}/1`;
  const provider = protocol === "app_local" ? undefined : "example.test";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, ...(provider === undefined ? {} : { provider }) }),
    kind,
    protocol,
    nativeId,
    ...(provider === undefined ? {} : { provider }),
    verification: {
      state: kind === "topic" ? "canonical" : "authority_verified",
      ...(kind === "topic" ? {} : { authority: nativeId, verifiedAt: OBSERVED_AT })
    },
    availability: "available",
    observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{
      kind: kind === "topic" ? "local_catalog" : "provider_discovery",
      sourceId: "test-source",
      observedAt: OBSERVED_AT,
      trustBoundary: kind === "topic" ? "user_owned" : "same_provider"
    }]
  };
}

function eligible(value: RecommendationCandidate): RecommendationCandidateEligibilityResult {
  return { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT };
}

const EXPECTED_ACTIONS: ReadonlyArray<readonly [RecommendationCandidateKind, string]> = [
  ["account", "follow_account"],
  ["feed", "subscribe_feed"],
  ["list", "subscribe_list"],
  ["starter_pack", "expand_starter_pack"],
  ["labeler", "subscribe_labeler"],
  ["community", "follow_community"],
  ["hashtag", "follow_hashtag"],
  ["instance", "open_instance_signup"]
];

test("Phase 6 maps supported candidate kinds to non-executable explicit-confirmation plans", () => {
  for (const [kind, action] of EXPECTED_ACTIONS) {
    const value = candidate(kind);
    const plan = createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), createdAt: CREATED_AT });
    assert.equal(plan.action, action);
    assert.equal(plan.candidate.candidateId, value.candidateId);
    assert.equal(plan.requiresExplicitUserConfirmation, true);
    assert.equal(plan.requiresIdentityRevalidation, true);
    assert.equal(plan.requiresEligibilityRevalidation, true);
    assert.equal(plan.executable, false);
  }
});

test("Phase 6 rejects unsupported post and topic mutation plans", () => {
  for (const kind of ["post", "topic"] as const) {
    const value = candidate(kind);
    assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), createdAt: CREATED_AT }), /no mutation action-plan contract/u);
  }
});

test("Phase 6 fails closed for ineligible or non-explicit eligibility", () => {
  const value = candidate("account");
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: { ...eligible(value), eligible: false, reasonCodes: ["candidate_unavailable"] }, createdAt: CREATED_AT }), /requires current eligibility/u);
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: { ...eligible(value), reasonCodes: [] }, createdAt: CREATED_AT }), /requires explicit eligible evidence/u);
});

test("Phase 6 binds eligibility to the exact candidate snapshot", () => {
  const value = candidate("account");
  const changed: RecommendationCandidate = { ...value, observedAt: "2026-09-26T06:00:30.000Z" };
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(changed), createdAt: CREATED_AT }), /exact candidate snapshot/u);
});

test("Phase 6 rejects eligibility timestamps newer than the action plan", () => {
  const value = candidate("account");
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: { ...eligible(value), evaluatedAt: "2026-09-26T06:03:00.000Z" }, createdAt: CREATED_AT }), /eligibility cannot be newer/u);
});

test("Phase 6 bounds starter-pack expansion and scopes the limit to starter packs", () => {
  const pack = candidate("starter_pack");
  assert.equal(createRecommendationCandidateActionPlan({ candidate: pack, eligibility: eligible(pack), createdAt: CREATED_AT }).maxStarterPackMembers, 100);
  assert.equal(createRecommendationCandidateActionPlan({ candidate: pack, eligibility: eligible(pack), createdAt: CREATED_AT, maxStarterPackMembers: 250 }).maxStarterPackMembers, 250);
  for (const invalid of [0, 1001, 1.5, Number.NaN]) assert.throws(() => createRecommendationCandidateActionPlan({ candidate: pack, eligibility: eligible(pack), createdAt: CREATED_AT, maxStarterPackMembers: invalid }), /starter-pack action limit/u);
  const account = candidate("account");
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: account, eligibility: eligible(account), createdAt: CREATED_AT, maxStarterPackMembers: 10 }), /only valid for starter-pack/u);
});
