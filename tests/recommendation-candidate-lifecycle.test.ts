import test from "node:test";
import assert from "node:assert/strict";
import {
  assessRecommendationCandidateActionPlan,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  createRecommendationCuratedAccountSetSourceId,
  listRecommendationLifecycleExcludedCandidateIds,
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidate,
  type RecommendationCandidateActionPlan,
  type RecommendationCandidateKind,
  type RecommendationCandidateLifecycleEvent
} from "../src/index.js";
import { MEMBER_OBSERVED_AT, MEMBER_SET, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
const LATER = "2026-09-26T06:30:00.000Z";
const NOW = "2026-09-26T06:45:00.000Z";
const SET_SOURCE_ID = createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId);

function candidate(kind: RecommendationCandidateKind, name = "1", sourceId = "test-source"): RecommendationCandidate {
  const nativeId = kind === "hashtag" ? "gaming" : `https://example.test/${kind === "account" ? "users" : kind}/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol: "activitypub", nativeId, provider: "example.test" }),
    kind, protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available", observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId, observedAt: OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}
function eligible(value: RecommendationCandidate) { return { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT } as const; }
function accountPlan(name = "alice"): RecommendationCandidateActionPlan {
  const value = candidate("account", name);
  return createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider("account"), createdAt: CREATED_AT });
}
function packPlan(names: readonly string[] = ["alice", "bob"]): RecommendationCandidateActionPlan {
  const value = candidate("starter_pack");
  return createRecommendationCandidateActionPlan({
    candidate: value, eligibility: eligible(value), provider: actionProvider("starter_pack"), createdAt: CREATED_AT,
    starterPackMembers: names.map((name) => starterPackMember(candidate("account", name), `acct-${name}`))
  });
}
function memberId(name: string): string { return candidate("account", name).candidateId; }
function assess(plan: RecommendationCandidateActionPlan, events: readonly RecommendationCandidateLifecycleEvent[], now = "2026-09-26T06:20:00.000Z") {
  return assessRecommendationCandidateActionPlan(plan, events, { now });
}

test("a plan with no reported changes is valid but still demands revalidation and never becomes executable", () => {
  const result = assess(packPlan(), []);
  assert.equal(result.state, "valid");
  assert.equal(result.usable, true);
  assert.equal(result.executable, false);
  assert.equal(result.requiresRevalidation, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.unaffectedMemberCandidateIds, [memberId("alice"), memberId("bob")].sort());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test("revoked or rejected member consent invalidates the plan and names only that member", () => {
  for (const kind of ["member_consent_revoked", "member_consent_rejected"] as const) {
    const result = assess(packPlan(), [{ kind, occurredAt: LATER, candidateId: memberId("bob"), setSourceId: SET_SOURCE_ID }], NOW);
    assert.equal(result.state, "invalid");
    assert.equal(result.usable, false);
    assert.deepEqual(result.reasons, [{ code: kind, candidateIds: [memberId("bob")] }]);
    assert.deepEqual(result.affectedMemberCandidateIds, [memberId("bob")]);
    assert.deepEqual(result.unaffectedMemberCandidateIds, [memberId("alice")]);
  }
});

test("consent events for another member, another set, or from before the consent was observed do not touch the plan", () => {
  const plan = packPlan();
  const other = createRecommendationCuratedAccountSetSourceId("mastodon_collection", "someone-else");
  assert.equal(assess(plan, [{ kind: "member_consent_revoked", occurredAt: LATER, candidateId: memberId("carol"), setSourceId: SET_SOURCE_ID }], NOW).state, "valid");
  assert.equal(assess(plan, [{ kind: "member_consent_revoked", occurredAt: LATER, candidateId: memberId("bob"), setSourceId: other }], NOW).state, "valid");
  // Revoked, then accepted again before the plan was built: the plan carries the later acceptance.
  assert.equal(assess(plan, [{ kind: "member_consent_revoked", occurredAt: "2026-09-26T05:00:00.000Z", candidateId: memberId("bob"), setSourceId: SET_SOURCE_ID }]).state, "valid");
});

test("an event at exactly the observation instant fails closed", () => {
  const result = assess(packPlan(), [{ kind: "member_consent_revoked", occurredAt: MEMBER_OBSERVED_AT, candidateId: memberId("alice"), setSourceId: SET_SOURCE_ID }]);
  assert.equal(result.state, "invalid");
});

test("a deleted, hidden or sensitive set invalidates every member from that set", () => {
  for (const kind of ["set_deleted", "set_not_discoverable", "set_sensitive"] as const) {
    const result = assess(packPlan(), [{ kind, occurredAt: LATER, setSourceId: SET_SOURCE_ID }], NOW);
    assert.equal(result.state, "invalid");
    assert.deepEqual(result.reasons, [{ code: kind, candidateIds: [memberId("alice"), memberId("bob")].sort() }]);
    assert.deepEqual(result.affectedMemberCandidateIds, [memberId("alice"), memberId("bob")].sort());
    assert.deepEqual(result.unaffectedMemberCandidateIds, []);
  }
});

test("a set that the starter-pack candidate itself came from invalidates the plan candidate", () => {
  const value = candidate("starter_pack", "1", SET_SOURCE_ID);
  const plan = createRecommendationCandidateActionPlan({
    candidate: value, eligibility: eligible(value), provider: actionProvider("starter_pack"), createdAt: CREATED_AT,
    starterPackMembers: [starterPackMember(candidate("account", "alice"), "acct-alice")]
  });
  const result = assess(plan, [{ kind: "set_deleted", occurredAt: LATER, setSourceId: SET_SOURCE_ID }], NOW);
  assert.equal(result.state, "invalid");
  assert.deepEqual(result.reasons[0]?.candidateIds, [value.candidateId, memberId("alice")].sort());
});

test("moved, deleted and unverified accounts invalidate by candidate ID or account URI", () => {
  const plan = accountPlan();
  const id = candidate("account", "alice").candidateId;
  assert.deepEqual(assess(plan, [{ kind: "account_moved", occurredAt: LATER, candidateId: id }], NOW).reasons, [{ code: "account_moved", candidateIds: [id] }]);
  assert.deepEqual(assess(plan, [{ kind: "account_deleted", occurredAt: LATER, accountUri: "https://example.test/users/alice" }], NOW).reasons, [{ code: "account_deleted", candidateIds: [id] }]);
  assert.deepEqual(assess(plan, [{ kind: "verification_lost", occurredAt: LATER, candidateId: id }], NOW).reasons, [{ code: "verification_lost", candidateIds: [id] }]);
  // verification is tracked per candidate; an account URI alone does not stand in for it
  assert.equal(assess(plan, [{ kind: "account_moved", occurredAt: LATER, accountUri: "https://example.test/users/mallory" }], NOW).state, "valid");
});

test("a moved starter-pack member invalidates the plan so the rebuild resolves the move again", () => {
  const result = assess(packPlan(), [{ kind: "account_moved", occurredAt: LATER, accountUri: "https://example.test/users/alice" }], NOW);
  assert.equal(result.state, "invalid");
  assert.deepEqual(result.affectedMemberCandidateIds, [memberId("alice")]);
});

test("losing every provenance source makes the plan stale, losing one of several does not", () => {
  const plan = accountPlan();
  assert.equal(assess(plan, [{ kind: "source_disappeared", occurredAt: LATER, sourceId: "test-source" }], NOW).state, "stale");
  assert.equal(assess(plan, [{ kind: "source_disappeared", occurredAt: LATER, sourceId: "other-source" }], NOW).state, "valid");
  const value: RecommendationCandidate = { ...candidate("account", "dana"), provenance: [candidate("account").provenance[0]!, { ...candidate("account").provenance[0]!, sourceId: "second" }] };
  const two = createRecommendationCandidateActionPlan({ candidate: value, eligibility: eligible(value), provider: actionProvider("account"), createdAt: CREATED_AT });
  assert.equal(assess(two, [{ kind: "source_disappeared", occurredAt: LATER, sourceId: "test-source" }], NOW).state, "valid");
  assert.equal(assess(two, [{ kind: "source_disappeared", occurredAt: LATER, sourceId: "test-source" }, { kind: "source_disappeared", occurredAt: LATER, sourceId: "second" }], NOW).state, "stale");
});

test("provider capability loss and age make a plan stale, and invalid reasons win over stale ones", () => {
  const plan = accountPlan();
  assert.deepEqual(assess(plan, [{ kind: "provider_capability_lost", occurredAt: LATER, providerId: "example.test" }], NOW).reasons.map((r) => r.code), ["provider_capability_lost"]);
  assert.equal(assess(plan, [{ kind: "provider_capability_lost", occurredAt: LATER, providerId: "elsewhere.test" }], NOW).state, "valid");
  // capabilities in the fixture expire at 07:00
  assert.deepEqual(assess(plan, [], "2026-09-26T07:00:00.000Z").reasons.map((r) => r.code), ["capability_expired"]);
  // default eligibility age is 24 hours
  assert.deepEqual(assess(plan, [], "2026-09-27T06:01:00.001Z").reasons.map((r) => r.code), ["capability_expired", "eligibility_aged"]);
  const mixed = assess(plan, [{ kind: "provider_capability_lost", occurredAt: LATER, providerId: "example.test" }, { kind: "account_deleted", occurredAt: LATER, candidateId: plan.candidate.candidateId }], NOW);
  assert.equal(mixed.state, "invalid");
  assert.deepEqual(mixed.reasons.map((r) => r.code), ["account_deleted", "provider_capability_lost"]);
});

test("the eligibility age limit is configurable and bounded", () => {
  const plan = accountPlan();
  const early = "2026-09-26T06:10:00.000Z";
  assert.equal(assessRecommendationCandidateActionPlan(plan, [], { now: early, maxEligibilityAgeMs: 60_000 }).reasons[0]?.code, "eligibility_aged");
  for (const bad of [0, 59_999, 31 * 24 * 3_600_000, 1.5, Number.NaN, "1000" as unknown as number]) {
    assert.throws(() => assessRecommendationCandidateActionPlan(plan, [], { now: early, maxEligibilityAgeMs: bad }), /age limit/u);
  }
});

test("assessment is deterministic, order independent, and does not mutate the plan or events", () => {
  const plan = packPlan();
  const events: RecommendationCandidateLifecycleEvent[] = [
    { kind: "set_deleted", occurredAt: LATER, setSourceId: SET_SOURCE_ID },
    { kind: "member_consent_revoked", occurredAt: LATER, candidateId: memberId("alice"), setSourceId: SET_SOURCE_ID }
  ];
  const before = JSON.stringify(plan);
  const first = assess(plan, events, NOW);
  const second = assess(plan, [...events].reverse().concat(events), NOW);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(plan), before);
  assert.equal(events.length, 2);
});

test("malformed, oversized and future-dated events are rejected rather than ignored", () => {
  const ok = { kind: "set_deleted", occurredAt: LATER, setSourceId: SET_SOURCE_ID } as const;
  const bad: unknown[] = [
    null, "set_deleted", { ...ok, kind: "plan_executed" }, { ...ok, extra: 1 }, { ...ok, candidateId: "" }, { ...ok, candidateId: " padded " },
    { ...ok, candidateId: "bad\u0000id" }, { ...ok, candidateId: "x".repeat(2049) }, { ...ok, providerId: "example.test" },
    { kind: "set_deleted", occurredAt: LATER }, { kind: "member_consent_revoked", occurredAt: LATER, candidateId: "a" },
    { kind: "account_moved", occurredAt: LATER }, { kind: "provider_capability_lost", occurredAt: LATER },
    { ...ok, occurredAt: "yesterday" }, { ...ok, occurredAt: undefined }, { ...ok, occurredAt: "2026-09-26T09:00:00.000Z" }
  ];
  for (const event of bad) assert.throws(() => normalizeRecommendationCandidateLifecycleEvents([event], { now: NOW }), TypeError, JSON.stringify(event));
  assert.throws(() => normalizeRecommendationCandidateLifecycleEvents("nope", { now: NOW }), TypeError);
  assert.throws(() => normalizeRecommendationCandidateLifecycleEvents(Array.from({ length: 1001 }, () => ok), { now: NOW }), RangeError);
  assert.equal(normalizeRecommendationCandidateLifecycleEvents(Array.from({ length: 1000 }, () => ok), { now: NOW }).length, 1);
  assert.throws(() => assess(accountPlan(), [{ ...ok, occurredAt: "2026-09-26T09:00:00.000Z" }], NOW));
});

test("assessment refuses a plan that claims to be executable or lacks the expected shape", () => {
  const plan = accountPlan();
  assert.throws(() => assess({ ...plan, executable: true } as unknown as RecommendationCandidateActionPlan, []), /Invalid recommendation candidate action plan/u);
  assert.throws(() => assess({ ...plan, schemaVersion: "other" } as unknown as RecommendationCandidateActionPlan, []), TypeError);
  assert.throws(() => assess(null as unknown as RecommendationCandidateActionPlan, []), TypeError);
  assert.throws(() => assess({ ...packPlan(), members: [{}] } as unknown as RecommendationCandidateActionPlan, []), TypeError);
});

test("excluded candidate IDs come only from IDs the reporter supplied, sorted and unique", () => {
  const events = normalizeRecommendationCandidateLifecycleEvents([
    { kind: "account_moved", occurredAt: LATER, candidateId: "b" },
    { kind: "verification_lost", occurredAt: LATER, candidateId: "a" },
    { kind: "account_deleted", occurredAt: LATER, candidateId: "b" },
    { kind: "set_deleted", occurredAt: LATER, setSourceId: SET_SOURCE_ID },
    { kind: "provider_capability_lost", occurredAt: LATER, providerId: "example.test" }
  ], { now: NOW });
  assert.deepEqual(listRecommendationLifecycleExcludedCandidateIds(events), ["a", "b"]);
});
