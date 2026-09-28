import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationCandidateActionPlan, createRecommendationCandidateId, type RecommendationCandidate, type RecommendationCandidateEligibilityResult, type RecommendationCandidateKind, type RecommendationProviderDescriptor } from "../src/index.js";
import { actionProvider } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
function candidate(kind: RecommendationCandidateKind): RecommendationCandidate {
  const protocol = kind === "topic" ? "app_local" as const : "activitypub" as const;
  const nativeId = kind === "hashtag" ? "gaming" : `https://example.test/${kind}/1`;
  const provider = protocol === "app_local" ? undefined : "example.test";
  return { candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, ...(provider === undefined ? {} : { provider }) }), kind, protocol, nativeId, ...(provider === undefined ? {} : { provider }), verification: { state: kind === "topic" ? "canonical" : "authority_verified", authority: kind === "topic" ? "test-source" : nativeId, verifiedAt: OBSERVED_AT }, availability: "available", observedAt: OBSERVED_AT, metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] }, provenance: [{ kind: kind === "topic" ? "local_catalog" : "provider_discovery", sourceId: "test-source", observedAt: OBSERVED_AT, trustBoundary: kind === "topic" ? "user_owned" : "same_provider" }] };
}
function eligible(value: RecommendationCandidate): RecommendationCandidateEligibilityResult { return { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT }; }
function plan(value: RecommendationCandidate, eligibility = eligible(value), provider = actionProvider(value.kind, value.protocol), extras: { maxStarterPackMembers?: number } = {}) { return createRecommendationCandidateActionPlan({ candidate: value, eligibility, provider, createdAt: CREATED_AT, ...extras }); }
const EXPECTED_ACTIONS: ReadonlyArray<readonly [RecommendationCandidateKind, string]> = [["account", "follow_account"], ["feed", "subscribe_feed"], ["list", "subscribe_list"], ["starter_pack", "expand_starter_pack"], ["labeler", "subscribe_labeler"], ["community", "follow_community"], ["hashtag", "follow_hashtag"], ["instance", "open_instance_signup"]];

test("Phase 6 maps supported candidate kinds to non-executable explicit-confirmation plans", () => {
  for (const [kind, action] of EXPECTED_ACTIONS) { const value = candidate(kind); const result = plan(value); assert.equal(result.action, action); assert.equal(result.candidate.candidateId, value.candidateId); assert.equal(result.requiresExplicitUserConfirmation, true); assert.equal(result.requiresIdentityRevalidation, true); assert.equal(result.requiresEligibilityRevalidation, true); assert.equal(result.requiresCapabilityRevalidation, true); assert.equal(result.executable, false); }
});
test("Phase 6 rejects unsupported post and topic mutation plans", () => { for (const kind of ["post", "topic"] as const) { const value = candidate(kind); assert.throws(() => plan(value), /no mutation action-plan contract/u); } });
test("Phase 6 fails closed for ineligible, malformed, or non-explicit eligibility", () => {
  const value = candidate("account");
  assert.throws(() => plan(value, { ...eligible(value), eligible: false, reasonCodes: ["candidate_unavailable"] }), /requires current eligibility/u);
  assert.throws(() => plan(value, { ...eligible(value), eligible: "false" as unknown as boolean }), /requires current eligibility/u);
  assert.throws(() => plan(value, { ...eligible(value), reasonCodes: [] }), /requires explicit eligible evidence/u);
});
test("Phase 6 binds eligibility to the exact candidate snapshot", () => { const value = candidate("account"); const changed: RecommendationCandidate = { ...value, observedAt: "2026-09-26T06:00:30.000Z" }; assert.throws(() => plan(value, eligible(changed)), /exact candidate snapshot/u); });
test("Phase 6 rejects eligibility timestamps newer than the action plan", () => { const value = candidate("account"); assert.throws(() => plan(value, { ...eligible(value), evaluatedAt: "2026-09-26T06:03:00.000Z" }), /eligibility cannot be newer/u); });
test("Phase 6 requires fresh matching verified provider capability evidence", () => {
  const value = candidate("list"); const supported = actionProvider("list");
  assert.throws(() => plan(value, eligible(value), { ...supported, providerId: "other.test" }), /matching provider capability/u);
  assert.throws(() => plan(value, eligible(value), { ...supported, expiresAt: CREATED_AT }), /fresh provider capability/u);
  assert.throws(() => plan(value, eligible(value), { ...supported, protocolBindings: supported.protocolBindings.map((binding) => ({ ...binding, verification: "asserted" as const })) }), /verified provider protocol/u);
  const unsupported: RecommendationProviderDescriptor = { ...supported, capabilities: supported.capabilities.map((capability) => ({ ...capability, state: "unsupported" as const })) };
  assert.throws(() => plan(value, eligible(value), unsupported), /supported provider action capability/u);
  const unknown: RecommendationProviderDescriptor = { ...supported, capabilities: supported.capabilities.map((capability) => ({ ...capability, state: "unknown" as const })) };
  assert.throws(() => plan(value, eligible(value), unknown), /supported provider action capability/u);
});
test("Phase 6 bounds starter-pack expansion and scopes the limit to starter packs", () => {
  const pack = candidate("starter_pack"); assert.equal(plan(pack).maxStarterPackMembers, 100); assert.equal(plan(pack, eligible(pack), actionProvider("starter_pack"), { maxStarterPackMembers: 250 }).maxStarterPackMembers, 250);
  for (const invalid of [0, 1001, 1.5, Number.NaN]) assert.throws(() => plan(pack, eligible(pack), actionProvider("starter_pack"), { maxStarterPackMembers: invalid }), /starter-pack action limit/u);
  const account = candidate("account"); assert.throws(() => plan(account, eligible(account), actionProvider("account"), { maxStarterPackMembers: 10 }), /only valid for starter-pack/u);
});
