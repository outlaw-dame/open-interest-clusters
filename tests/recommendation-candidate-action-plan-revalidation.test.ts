import test from "node:test";
import assert from "node:assert/strict";
import { RECOMMENDATION_CANDIDATE_ACTIONS, createRecommendationCandidateActionPlan, createRecommendationCandidateId, type RecommendationCandidate, type RecommendationCandidateEligibilityResult, type RecommendationCandidateKind } from "../src/index.js";
import { actionProvider } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
const KINDS: readonly RecommendationCandidateKind[] = ["account", "feed", "list", "starter_pack", "labeler", "community", "hashtag", "instance"];
const FLAGS = ["requiresExplicitUserConfirmation", "requiresIdentityRevalidation", "requiresEligibilityRevalidation", "requiresCapabilityRevalidation"] as const;
// Property names a caller might try to smuggle in to switch the safeguards off.
const SPOOFED = { executable: true, ...Object.fromEntries(FLAGS.map((flag) => [flag, false])) };

function candidate(kind: RecommendationCandidateKind, name = "1"): RecommendationCandidate {
  const nativeId = kind === "hashtag" ? "gaming" : `https://example.test/${kind === "account" ? "users" : kind}/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol: "activitypub", nativeId, provider: "example.test" }),
    kind, protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available", observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "test-source", observedAt: OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}
function eligible(value: RecommendationCandidate): RecommendationCandidateEligibilityResult { return { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT }; }
function member(name: string): RecommendationCandidateEligibilityResult {
  const value = candidate("account", name);
  return { ...eligible(value), resolvedAccount: { id: `acct-${name}`, uri: value.nativeId } };
}
function plan(kind: RecommendationCandidateKind, extra: Record<string, unknown> = {}) {
  const value = candidate(kind);
  const members = kind === "starter_pack" ? [member("alice"), member("bob")] : undefined;
  return createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider(kind), createdAt: CREATED_AT, ...(members === undefined ? {} : { starterPackMembers: members }), ...extra } as never);
}
function assertGuarded(value: ReturnType<typeof plan>) {
  for (const flag of FLAGS) assert.equal(value[flag], true, flag);
  assert.equal(value.executable, false);
}

test("every action kind is covered by the revalidation checks", () => {
  assert.equal(KINDS.length, RECOMMENDATION_CANDIDATE_ACTIONS.length);
  assert.equal(new Set(KINDS.map((kind) => plan(kind).action)).size, RECOMMENDATION_CANDIDATE_ACTIONS.length);
});

test("every plan kind carries all revalidation flags as true and stays non-executable", () => {
  for (const kind of KINDS) assertGuarded(plan(kind));
});

test("starter-pack plans with members keep the revalidation flags", () => {
  const value = plan("starter_pack");
  assert.equal(value.members?.length, 2);
  assertGuarded(value);
  assertGuarded(plan("starter_pack", { maxStarterPackMembers: 2 }));
});

test("flag keys are own enumerable properties so they survive serialization", () => {
  for (const kind of KINDS) {
    const roundTripped = JSON.parse(JSON.stringify(plan(kind))) as Record<string, unknown>;
    for (const flag of FLAGS) assert.equal(roundTripped[flag], true, `${kind} ${flag}`);
    assert.equal(roundTripped.executable, false);
  }
});

test("spoofed flags on the options object cannot change the plan", () => {
  for (const kind of KINDS) assertGuarded(plan(kind, SPOOFED));
});

test("spoofed flags on the candidate and eligibility result cannot change the plan", () => {
  for (const kind of KINDS) {
    const value = { ...candidate(kind), ...SPOOFED };
    const members = kind === "starter_pack" ? [{ ...member("alice"), ...SPOOFED }] : undefined;
    const result = createRecommendationCandidateActionPlan({ candidate: value, eligibility: { ...eligible(value), ...SPOOFED }, provider: { ...actionProvider(kind), ...SPOOFED }, createdAt: CREATED_AT, ...(members === undefined ? {} : { starterPackMembers: members }) } as never);
    assertGuarded(result);
    assert.equal(Object.hasOwn(result.candidate, "executable"), false);
  }
});

test("spoofed flags on starter-pack member bindings do not reach the plan", () => {
  const value = plan("starter_pack", { starterPackMembers: [{ ...member("alice"), ...SPOOFED }] });
  assertGuarded(value);
  assert.deepEqual(Object.keys(value.members![0]!).sort(), ["accountId", "accountUri", "candidateId", "eligibilityEvaluatedAt"]);
});

test("untyped callers cannot opt out through falsy or truthy option values", () => {
  for (const kind of KINDS) {
    for (const bad of [false, 0, null, "false", {}, []]) assertGuarded(plan(kind, Object.fromEntries([...FLAGS, "executable", "execute", "skipRevalidation"].map((key) => [key, bad]))));
  }
});

test("plans are frozen so the flags cannot be flipped afterwards", () => {
  for (const kind of KINDS) {
    const value = plan(kind) as unknown as Record<string, unknown>;
    assert.ok(Object.isFrozen(value));
    for (const flag of [...FLAGS, "executable"]) assert.throws(() => { value[flag] = flag === "executable"; }, TypeError);
    assertGuarded(value as unknown as ReturnType<typeof plan>);
  }
});

test("instance plans need no capability entry but still require a verified protocol binding", () => {
  const value = candidate("instance");
  const provider = actionProvider("instance");
  assert.deepEqual(provider.capabilities, []);
  const created = createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider, createdAt: CREATED_AT });
  assert.equal(created.action, "open_instance_signup");
  assertGuarded(created);
  // Provider capabilities that do not support anything are irrelevant for instances.
  assertGuarded(createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: { ...provider, capabilities: [{ capability: "follows", state: "unsupported", authority: "protocol_native", protocol: "activitypub" }] }, createdAt: CREATED_AT }));
  const unverified = { ...provider, protocolBindings: [{ protocol: "activitypub", authority: "protocol_native", verification: "unverified" }] };
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: unverified as never, createdAt: CREATED_AT }), /verified provider protocol binding/u);
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: { ...provider, protocolBindings: [] }, createdAt: CREATED_AT }), /verified provider protocol binding/u);
});

test("non-instance kinds fail closed when the capability is missing, so no flagged plan is produced", () => {
  for (const kind of KINDS.filter((item) => item !== "instance")) {
    const value = candidate(kind);
    assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: { ...actionProvider(kind), capabilities: [] }, createdAt: CREATED_AT }), /supported provider action capability/u, kind);
  }
});
