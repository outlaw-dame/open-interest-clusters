import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationCandidateActionPlan, createRecommendationCandidateId, type RecommendationCandidate, type RecommendationCandidateEligibilityResult, type RecommendationCandidateKind } from "../src/index.js";
import { actionProvider } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";

function candidate(kind: RecommendationCandidateKind, name = "1", provenanceSource = "test-source"): RecommendationCandidate {
  const nativeId = kind === "hashtag" ? "gaming" : `https://example.test/${kind === "account" ? "users" : kind}/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol: "activitypub", nativeId, provider: "example.test" }),
    kind, protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available", observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: provenanceSource, observedAt: OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}
function eligible(value: RecommendationCandidate): RecommendationCandidateEligibilityResult { return { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT }; }
function member(name: string): RecommendationCandidateEligibilityResult {
  const value = candidate("account", name);
  return { ...eligible(value), resolvedAccount: { id: `acct-${name}`, uri: value.nativeId } };
}
function pack(members?: unknown, limit?: number) {
  const value = candidate("starter_pack");
  return createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider("starter_pack"), createdAt: CREATED_AT, ...(limit === undefined ? {} : { maxStarterPackMembers: limit }), ...(members === undefined ? {} : { starterPackMembers: members as RecommendationCandidateEligibilityResult[] }) });
}

test("starter-pack plans bind each member to its resolved account identity", () => {
  const plan = pack([member("alice"), member("bob")]);
  assert.deepEqual(plan.members, [
    { candidateId: member("alice").candidate.candidateId, accountId: "acct-alice", accountUri: "https://example.test/users/alice", eligibilityEvaluatedAt: EVALUATED_AT },
    { candidateId: member("bob").candidate.candidateId, accountId: "acct-bob", accountUri: "https://example.test/users/bob", eligibilityEvaluatedAt: EVALUATED_AT }
  ]);
  assert.equal(plan.executable, false);
  assert.ok(Object.isFrozen(plan.members));
  assert.ok(Object.isFrozen(plan.members?.[0]));
});

test("starter-pack plans fail closed without usable member evidence", () => {
  assert.throws(() => pack(), /at least one eligible member/u);
  assert.throws(() => pack([]), /at least one eligible member/u);
  assert.throws(() => pack("alice"), /at least one eligible member/u);
  assert.throws(() => pack([null]), /member eligibility/u);
});

test("starter-pack members must be eligible accounts with a resolved identity", () => {
  const ok = member("alice");
  assert.throws(() => pack([{ ...ok, eligible: false, reasonCodes: ["account_inactive"] }]), /explicit eligible evidence/u);
  assert.throws(() => pack([{ ...ok, reasonCodes: [] }]), /explicit eligible evidence/u);
  assert.throws(() => pack([{ ...ok, eligible: "true" as unknown as boolean }]), /explicit eligible evidence/u);
  const { resolvedAccount: _omitted, ...unresolved } = ok;
  assert.throws(() => pack([unresolved]), /resolved account identity/u);
  const feed = eligible(candidate("feed"));
  assert.throws(() => pack([{ ...feed, resolvedAccount: { id: "x", uri: "https://example.test/x" } }]), /must be account candidates/u);
  for (const flag of ["deactivated", "suspended", "deleted"] as const) assert.throws(() => pack([{ ...ok, resolvedAccount: { ...ok.resolvedAccount!, [flag]: true } }]), /unavailable account/u);
  for (const bad of ["", " padded ", "bad\u0000id", "x".repeat(2049)]) {
    assert.throws(() => pack([{ ...ok, resolvedAccount: { ...ok.resolvedAccount!, id: bad } }]), /member identity/u);
    assert.throws(() => pack([{ ...ok, resolvedAccount: { ...ok.resolvedAccount!, uri: bad } }]), /member identity/u);
  }
});

test("starter-pack members cannot be newer than the plan or duplicated", () => {
  const ok = member("alice");
  assert.throws(() => pack([{ ...ok, evaluatedAt: "2026-09-26T06:03:00.000Z" }]), /cannot be newer/u);
  assert.throws(() => pack([{ ...ok, evaluatedAt: "not a time" }]), /timestamp/u);
  assert.throws(() => pack([ok, ok]), /distinct accounts/u);
  const alias = { ...member("bob"), resolvedAccount: { id: "acct-alice", uri: "https://example.test/users/alice" } };
  assert.throws(() => pack([ok, alias]), /distinct accounts/u);
});

test("starter-pack member count is bounded by the plan limit", () => {
  assert.equal(pack([member("a"), member("b")], 2).members?.length, 2);
  assert.throws(() => pack([member("a"), member("b"), member("c")], 2), /exceed the action limit/u);
});

test("member bindings are rejected for non-starter-pack plans", () => {
  const value = candidate("account");
  assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider("account"), createdAt: CREATED_AT, starterPackMembers: [member("a")] }), /only valid for starter-pack/u);
});

const SAFE_KEYS = ["schemaVersion", "candidate", "action", "createdAt", "eligibilityEvaluatedAt", "providerCapabilitiesExpireAt", "requiresExplicitUserConfirmation", "requiresIdentityRevalidation", "requiresEligibilityRevalidation", "requiresCapabilityRevalidation", "executable"];
const SENSITIVE = { accessToken: "secret-token", oauthToken: "oauth-secret", password: "hunter2", credentials: { key: "k" }, mutedAccounts: ["x"], blockedDomains: ["bad.test"], moderationState: { reports: 3 }, viewerId: "viewer-1", personalization: { interests: ["a"] } };

test("action plans expose only the allowed key set for every plan kind", () => {
  const kinds: RecommendationCandidateKind[] = ["account", "feed", "list", "starter_pack", "labeler", "community", "hashtag", "instance"];
  for (const kind of kinds) {
    const value = candidate(kind);
    const plan = createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider(kind), createdAt: CREATED_AT, ...(kind === "starter_pack" ? { starterPackMembers: [member("alice")] } : {}) });
    const expected = kind === "starter_pack" ? [...SAFE_KEYS, "maxStarterPackMembers", "members"] : SAFE_KEYS;
    assert.deepEqual(Object.keys(plan).sort(), [...expected].sort(), kind);
    assert.deepEqual(Object.keys(plan.candidate).sort(), ["availability", "candidateId", "kind", "metadata", "nativeId", "observedAt", "protocol", "provenance", "provider", "verification"], kind);
  }
});

test("injected sensitive fields on candidates, eligibility results, and members never reach the plan", () => {
  const value = { ...candidate("starter_pack"), ...SENSITIVE } as RecommendationCandidate;
  const eligibility = { ...eligible(value), ...SENSITIVE } as RecommendationCandidateEligibilityResult;
  const dirty = member("alice");
  const dirtyMember = { ...dirty, ...SENSITIVE, candidate: { ...dirty.candidate, ...SENSITIVE }, resolvedAccount: { ...dirty.resolvedAccount!, ...SENSITIVE } } as RecommendationCandidateEligibilityResult;
  const plan = createRecommendationCandidateActionPlan({ candidate: value, eligibility, provider: { ...actionProvider("starter_pack"), ...SENSITIVE } as never, createdAt: CREATED_AT, starterPackMembers: [dirtyMember] });
  const json = JSON.stringify(plan);
  for (const needle of ["secret-token", "oauth-secret", "hunter2", "bad.test", "viewer-1", "moderationState", "personalization", "accessToken"]) assert.ok(!json.includes(needle), needle);
  assert.deepEqual(Object.keys(plan.members![0]!).sort(), ["accountId", "accountUri", "candidateId", "eligibilityEvaluatedAt"]);
});

test("a provenance mismatch breaks the candidate snapshot check", () => {
  const value = candidate("account");
  const variants: RecommendationCandidate[] = [
    { ...value, provenance: [{ ...value.provenance[0]!, sourceId: "other-source" }] },
    { ...value, provenance: [{ ...value.provenance[0]!, observedAt: "2026-09-26T06:00:30.000Z" }] },
    { ...value, provenance: [{ ...value.provenance[0]!, trustBoundary: "remote_provider" }] },
    { ...value, provenance: [...value.provenance, { ...value.provenance[0]!, sourceId: "extra" }] },
    { ...value, provenance: [{ ...value.provenance[0]!, sourceItemId: "item-1" }] }
  ];
  for (const changed of variants) assert.throws(() => createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(changed), provider: actionProvider("account"), createdAt: CREATED_AT }), /exact candidate snapshot/u);
});
