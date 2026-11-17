import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationCandidateActionPlan, createRecommendationCandidateId, type RecommendationCandidate, type RecommendationCandidateEligibilityResult, type RecommendationCandidateKind, type RecommendationStarterPackMemberInput, createRecommendationCuratedAccountSetCandidateSourceAdapter, createRecommendationCuratedAccountSetSourceId, readRecommendationCandidateSourceAdapter, type RecommendationCuratedAccountSet } from "../src/index.js";
import { MEMBER_OBSERVED_AT, MEMBER_SET, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

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
function member(name: string): RecommendationStarterPackMemberInput { return starterPackMember(candidate("account", name), `acct-${name}`); }
/** Applies a change to the eligibility half of a member. */
function withEligibility(base: RecommendationStarterPackMemberInput, change: Partial<RecommendationCandidateEligibilityResult>): RecommendationStarterPackMemberInput { return { ...base, eligibility: { ...base.eligibility, ...change } }; }
function withConsent(base: RecommendationStarterPackMemberInput, change: Record<string, unknown>): RecommendationStarterPackMemberInput { return { ...base, consent: { ...base.consent, ...change } as RecommendationStarterPackMemberInput["consent"] }; }
function pack(members?: unknown, limit?: number) {
  const value = candidate("starter_pack");
  return createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider("starter_pack"), createdAt: CREATED_AT, ...(limit === undefined ? {} : { maxStarterPackMembers: limit }), ...(members === undefined ? {} : { starterPackMembers: members as RecommendationStarterPackMemberInput[] }) });
}

test("starter-pack plans bind each member to its resolved account identity and accepted consent", () => {
  const plan = pack([member("alice"), member("bob")]);
  const sourceId = createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId);
  assert.deepEqual(plan.members, [
    { candidateId: member("alice").eligibility.candidate.candidateId, accountId: "acct-alice", accountUri: "https://example.test/users/alice", eligibilityEvaluatedAt: EVALUATED_AT, consentState: "accepted", consentSetSourceId: sourceId, consentObservedAt: MEMBER_OBSERVED_AT },
    { candidateId: member("bob").eligibility.candidate.candidateId, accountId: "acct-bob", accountUri: "https://example.test/users/bob", eligibilityEvaluatedAt: EVALUATED_AT, consentState: "accepted", consentSetSourceId: sourceId, consentObservedAt: MEMBER_OBSERVED_AT }
  ]);
  assert.ok(!JSON.stringify(plan.members).includes(MEMBER_SET.setId));
  assert.equal(plan.executable, false);
  assert.ok(Object.isFrozen(plan.members));
  assert.ok(Object.isFrozen(plan.members?.[0]));
});

test("starter-pack plans fail closed without usable member evidence", () => {
  assert.throws(() => pack(), /at least one eligible member/u);
  assert.throws(() => pack([]), /at least one eligible member/u);
  assert.throws(() => pack("alice"), /at least one eligible member/u);
  assert.throws(() => pack([null]), /member eligibility/u);
  assert.throws(() => pack([{ consent: member("a").consent }]), /member eligibility/u);
  assert.throws(() => pack([{ eligibility: member("a").eligibility }]), /member consent/u);
  assert.throws(() => pack([{ ...member("a"), consent: null }]), /member consent/u);
});

test("starter-pack members must be eligible accounts with a resolved identity", () => {
  const ok = member("alice");
  assert.throws(() => pack([withEligibility(ok, { eligible: false, reasonCodes: ["account_inactive"] })]), /explicit eligible evidence/u);
  assert.throws(() => pack([withEligibility(ok, { reasonCodes: [] })]), /explicit eligible evidence/u);
  assert.throws(() => pack([withEligibility(ok, { eligible: "true" as unknown as boolean })]), /explicit eligible evidence/u);
  const { resolvedAccount: _omitted, ...unresolved } = ok.eligibility;
  assert.throws(() => pack([{ ...ok, eligibility: unresolved }]), /resolved account identity/u);
  const feed = starterPackMember(candidate("feed"), "feed-1");
  assert.throws(() => pack([feed]), /must be account candidates/u);
  for (const flag of ["deactivated", "suspended", "deleted"] as const) assert.throws(() => pack([withEligibility(ok, { resolvedAccount: { ...ok.eligibility.resolvedAccount!, [flag]: true } })]), /unavailable account/u);
  for (const bad of ["", " padded ", "bad\u0000id", "x".repeat(2049)]) {
    assert.throws(() => pack([withEligibility(ok, { resolvedAccount: { ...ok.eligibility.resolvedAccount!, id: bad } })]), /member identity/u);
    assert.throws(() => pack([withEligibility(ok, { resolvedAccount: { ...ok.eligibility.resolvedAccount!, uri: bad } })]), /member identity/u);
  }
});

test("a member whose candidate differs from its resolved account URI is rejected", () => {
  const ok = member("alice");
  assert.throws(() => pack([withEligibility(ok, { resolvedAccount: { id: "acct-alice", uri: "https://example.test/users/mallory" } })]), /match its resolved account URI/u);
});

test("starter-pack members cannot be newer than the plan or duplicated", () => {
  const ok = member("alice");
  assert.throws(() => pack([withEligibility(ok, { evaluatedAt: "2026-09-26T06:03:00.000Z" })]), /cannot be newer/u);
  assert.throws(() => pack([withEligibility(ok, { evaluatedAt: "not a time" })]), /timestamp/u);
  assert.throws(() => pack([ok, ok]), /distinct accounts/u);
  const alias = withEligibility(member("bob"), { resolvedAccount: { id: "acct-alice", uri: "https://example.test/users/bob" } });
  assert.throws(() => pack([ok, alias]), /distinct accounts/u);
});

test("only accepted membership consent is enough for a member", () => {
  for (const state of ["pending", "rejected", "revoked", "unknown", "ACCEPTED", "accepted ", "", undefined, null, true, {}]) {
    assert.throws(() => pack([withConsent(member("alice"), { state })]), /accepted membership consent/u, String(state));
  }
  assert.throws(() => pack([member("alice"), withConsent(member("bob"), { state: "revoked" })]), /accepted membership consent/u);
});

test("malformed consent fields are rejected", () => {
  const ok = member("alice");
  for (const bad of ["", " padded ", "bad\u0000id", "x".repeat(2049), 7, undefined, null]) {
    assert.throws(() => pack([withConsent(ok, { setProvider: bad })]), /member identity/u);
    assert.throws(() => pack([withConsent(ok, { setId: bad })]), /member identity/u);
  }
  for (const bad of ["", "yesterday", "2026-09-26", "2026-13-40T00:00:00Z", 5, undefined, null]) assert.throws(() => pack([withConsent(ok, { observedAt: bad })]), /consent timestamp/u);
});

test("consent observed after the plan is rejected", () => {
  const later = "2026-09-26T06:03:00.000Z";
  const base = member("alice");
  const stamped = { ...base.eligibility.candidate.provenance[0]!, observedAt: later };
  const future = { eligibility: { ...base.eligibility, candidate: { ...base.eligibility.candidate, provenance: [stamped] } }, consent: { ...base.consent, observedAt: later } };
  assert.throws(() => pack([future]), /consent cannot be newer than the plan/u);
});

test("consent must be backed by curated-set provenance on the member candidate", () => {
  const ok = member("alice");
  const only = ok.eligibility.candidate.provenance[0]!;
  const swap = (provenance: unknown[]) => withEligibility(ok, { candidate: { ...ok.eligibility.candidate, provenance: provenance as RecommendationCandidate["provenance"] } });
  assert.throws(() => pack([swap([])]), /provenance list/u);
  assert.throws(() => pack([swap([{ ...only, kind: "provider_discovery" }])]), /curated-set provenance/u);
  assert.throws(() => pack([withConsent(ok, { setId: "collection-2" })]), /curated-set provenance/u);
  assert.throws(() => pack([withConsent(ok, { setProvider: "loops_starter_kit" })]), /curated-set provenance/u);
  assert.throws(() => pack([swap([{ ...only, observedAt: "2026-09-26T05:00:00.000Z" }])]), /curated-set provenance/u);
  assert.throws(() => pack([withConsent(ok, { observedAt: "2026-09-26T05:00:00.000Z" })]), /curated-set provenance/u);
  const { sourceItemId: _dropped, ...noItem } = only;
  assert.throws(() => pack([swap([noItem])]), /curated-set provenance/u);
  assert.equal(pack([swap([{ ...only, sourceId: "unrelated" }, only])]).members?.length, 1);
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
  const dirtyMember = { ...dirty, ...SENSITIVE, consent: { ...dirty.consent, ...SENSITIVE }, eligibility: { ...dirty.eligibility, ...SENSITIVE, candidate: { ...dirty.eligibility.candidate, ...SENSITIVE }, resolvedAccount: { ...dirty.eligibility.resolvedAccount!, ...SENSITIVE } } } as RecommendationStarterPackMemberInput;
  const plan = createRecommendationCandidateActionPlan({ candidate: value, eligibility, provider: { ...actionProvider("starter_pack"), ...SENSITIVE } as never, createdAt: CREATED_AT, starterPackMembers: [dirtyMember] });
  const json = JSON.stringify(plan);
  for (const needle of ["secret-token", "oauth-secret", "hunter2", "bad.test", "viewer-1", "moderationState", "personalization", "accessToken"]) assert.ok(!json.includes(needle), needle);
  assert.deepEqual(Object.keys(plan.members![0]!).sort(), ["accountId", "accountUri", "candidateId", "consentObservedAt", "consentSetSourceId", "consentState", "eligibilityEvaluatedAt"]);
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

test("members built from the curated-set source adapter produce a valid plan", async () => {
  const curated = (accounts: Array<{ accountId: string; name: string; state: "accepted" | "pending" | "revoked" | "rejected" | "unknown" }>): RecommendationCuratedAccountSet => ({
    provider: MEMBER_SET.setProvider, id: MEMBER_SET.setId, url: "https://example.test/collections/collection-1", curatorId: "curator-1", name: "Gamers",
    discoverable: true, sensitive: false, observedAt: MEMBER_OBSERVED_AT, hashtags: ["gaming"], trustBoundary: "same_provider", membershipComplete: true,
    members: accounts.map((entry) => ({ accountId: entry.accountId, accountUri: `https://example.test/users/${entry.name}`, state: entry.state }))
  });
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets: [curated([
    { accountId: "acct-alice", name: "alice", state: "accepted" }, { accountId: "acct-bob", name: "bob", state: "accepted" }, { accountId: "acct-carol", name: "carol", state: "revoked" }, { accountId: "acct-dave", name: "dave", state: "pending" }
  ])] });
  const read = await readRecommendationCandidateSourceAdapter(adapter, { requestId: "members", candidateKinds: ["account"], canonicalInterestIds: [], limit: 10 });
  const found = read.candidates;
  assert.deepEqual(found.map((item) => item.nativeId).sort(), ["https://example.test/users/alice", "https://example.test/users/bob"]);
  const members: RecommendationStarterPackMemberInput[] = found.map((item) => {
    const accountId = item.provenance[0]!.sourceItemId!;
    return { eligibility: { candidate: item, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT, resolvedAccount: { id: accountId, uri: item.nativeId } }, consent: { state: "accepted", ...MEMBER_SET, observedAt: MEMBER_OBSERVED_AT } };
  });
  const plan = pack(members);
  assert.deepEqual(plan.members?.map((entry) => entry.accountId).sort(), ["acct-alice", "acct-bob"]);
  assert.ok(plan.members?.every((entry) => entry.consentState === "accepted"));
  // The revoked and pending members never became candidates, so there is nothing real to bind them to.
  assert.ok(!found.some((item) => item.nativeId.endsWith("/carol") || item.nativeId.endsWith("/dave")));
  const forged = withConsent(members[0]!, { setId: "some-other-collection" });
  assert.throws(() => pack([forged]), /curated-set provenance/u);
  const revoked = { ...members[0]!, consent: { ...members[0]!.consent, state: "revoked" as const } };
  assert.throws(() => pack([revoked]), /accepted membership consent/u);
});
