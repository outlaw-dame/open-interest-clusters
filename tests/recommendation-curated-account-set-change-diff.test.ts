import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS,
  assessRecommendationCandidateActionPlan,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  createRecommendationCuratedAccountSetMemberCandidateId,
  createRecommendationCuratedAccountSetSourceId,
  diffRecommendationCuratedAccountSet,
  listRecommendationLifecycleExcludedSetSourceIds,
  normalizeRecommendationCandidateLifecycleEvents,
  type RecommendationCandidate,
  type RecommendationCandidateActionPlan,
  type RecommendationCuratedAccountMember,
  type RecommendationCuratedAccountSet,
  type RecommendationCuratedAccountSetFreshRead
} from "../src/index.js";
import { MEMBER_OBSERVED_AT, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:05:00.000Z";
const SOURCE_ID = createRecommendationCuratedAccountSetSourceId("mastodon_collection", "collection-1");

function member(name: string, state: RecommendationCuratedAccountMember["state"] = "accepted"): RecommendationCuratedAccountMember {
  return { accountId: `id-${name}`, accountUri: `https://example.test/users/${name}`, state };
}
function curatedSet(overrides: Partial<RecommendationCuratedAccountSet> = {}): RecommendationCuratedAccountSet {
  return {
    provider: "mastodon_collection", id: "collection-1", url: "https://example.test/collections/1", curatorId: "curator",
    name: "Pack", discoverable: true, sensitive: false, observedAt: T0, hashtags: [], trustBoundary: "same_provider",
    membershipComplete: true, members: [member("alice"), member("bob")], ...overrides
  };
}
function found(overrides: Partial<RecommendationCuratedAccountSet> = {}): RecommendationCuratedAccountSetFreshRead {
  return { status: "found", set: curatedSet({ observedAt: T1, ...overrides }) };
}
function diff(fresh: RecommendationCuratedAccountSetFreshRead, previous = curatedSet()) {
  return diffRecommendationCuratedAccountSet({ subjectId: "subject-1", previous, fresh });
}
const candidateId = (name: string) => createRecommendationCuratedAccountSetMemberCandidateId(`https://example.test/users/${name}`);

test("an identical read yields no events", () => {
  const report = diff(found());
  assert.equal(report.outcome, "unchanged");
  assert.deepEqual(report.events, []);
  assert.equal(report.subjectId, "subject-1");
  assert.equal(report.setSourceId, SOURCE_ID);
});

test("an unknown read yields no events and never reads as deleted", () => {
  const report = diff({ status: "unknown" });
  assert.equal(report.outcome, "unknown");
  assert.deepEqual(report.events, []);
});

test("not_found for this set reports set_deleted at the read time", () => {
  const report = diff({ status: "not_found", provider: "mastodon_collection", setId: "collection-1", observedAt: T1 });
  assert.equal(report.outcome, "changed");
  assert.deepEqual(report.events, [{ kind: "set_deleted", occurredAt: T1, setSourceId: SOURCE_ID }]);
});

test("set flags only produce events when they get worse", () => {
  assert.deepEqual(diff(found({ discoverable: false })).events.map((e) => e.kind), ["set_not_discoverable"]);
  assert.deepEqual(diff(found({ sensitive: true })).events.map((e) => e.kind), ["set_sensitive"]);
  const both = diff(found({ discoverable: false, sensitive: true })).events.map((e) => e.kind).sort();
  assert.deepEqual(both, ["set_not_discoverable", "set_sensitive"]);
  const hidden = curatedSet({ discoverable: false, sensitive: true });
  assert.equal(diff(found(), hidden).outcome, "unchanged");
});

test("revoked, rejected and removed members are reported with their candidate IDs", () => {
  const previous = curatedSet({ members: [member("alice"), member("bob"), member("carol"), member("dave")] });
  const report = diff(found({ members: [member("alice", "revoked"), member("bob", "rejected"), member("carol")] }), previous);
  const byKind = Object.fromEntries(report.events.map((e) => [`${e.kind}:${e.candidateId}`, e]));
  assert.equal(report.events.length, 3);
  assert.ok(byKind[`member_consent_revoked:${candidateId("alice")}`]);
  assert.ok(byKind[`member_consent_rejected:${candidateId("bob")}`]);
  assert.ok(byKind[`member_consent_revoked:${candidateId("dave")}`]);
  assert.ok(report.events.every((e) => e.setSourceId === SOURCE_ID && e.occurredAt === T1));
});

test("set-level events do not need member events and consent events do not exclude the whole set", () => {
  const report = diff(found({ members: [member("alice", "revoked"), member("bob")] }));
  assert.deepEqual(listRecommendationLifecycleExcludedSetSourceIds(report.events), []);
});

test("output is the same however the member rows are ordered or repeated", () => {
  const previous = curatedSet({ members: [member("alice"), member("bob"), member("carol")] });
  const rows = [member("alice", "revoked"), member("bob", "rejected"), member("carol")];
  const base = diff(found({ members: rows }), previous);
  const shuffled = diff(found({ members: [rows[2]!, rows[0]!, rows[1]!, rows[0]!, rows[1]!] }), curatedSet({ members: [member("carol"), member("bob"), member("alice"), member("alice")] }));
  assert.deepEqual(shuffled.events, base.events);
  const ordered = [...base.events].map((e) => JSON.stringify(e));
  assert.deepEqual(ordered, [...ordered].sort((l, r) => (JSON.stringify(JSON.parse(l), Object.keys(JSON.parse(l)).sort()) < JSON.stringify(JSON.parse(r), Object.keys(JSON.parse(r)).sort()) ? -1 : 1)));
});

test("one revoked row cannot be cancelled by a duplicate accepted row", () => {
  const report = diff(found({ members: [member("alice"), member("alice", "revoked"), member("bob")] }));
  assert.deepEqual(report.events.map((e) => e.kind), ["member_consent_revoked"]);
});

test("a member whose account URI changed under the same ID counts as removed", () => {
  const swapped = { accountId: "id-alice", accountUri: "https://evil.test/users/alice", state: "accepted" } as const;
  const report = diff(found({ members: [swapped, member("bob")] }));
  assert.deepEqual(report.events.map((e) => e.candidateId), [candidateId("alice")]);
});

test("an incomplete member list proves nothing about removal, but explicit revocations still count", () => {
  const partial = diff(found({ membershipComplete: false, members: [member("alice", "revoked")] }));
  assert.deepEqual(partial.events.map((e) => [e.kind, e.candidateId]), [["member_consent_revoked", candidateId("alice")]]);
  assert.equal(diff(found({ membershipComplete: false, members: [member("alice")] })).outcome, "unchanged");
});

test("changes that make things better, and members that were never accepted, produce nothing", () => {
  const previous = curatedSet({ members: [member("alice"), member("pending", "pending"), { accountId: "id-x", state: "accepted" }] });
  const report = diff(found({ members: [member("alice"), member("zed"), member("pending", "revoked")] }), previous);
  assert.equal(report.outcome, "unchanged");
});

test("a previously accepted member moving to pending is not reported (no matching event kind)", () => {
  assert.equal(diff(found({ members: [member("alice", "pending"), member("bob")] })).outcome, "unchanged");
});

test("every produced event passes the library's own event validation and is exactly its normalized form", () => {
  const report = diff(found({ discoverable: false, sensitive: true, members: [member("alice", "revoked")] }));
  assert.deepEqual(normalizeRecommendationCandidateLifecycleEvents(report.events, { now: T1 }), report.events);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.events));
});

test("a set that is a different provider or ID is refused, found or not_found", () => {
  assert.throws(() => diff(found({ id: "collection-2" })), /does not match/);
  assert.throws(() => diff(found({ provider: "loops_starter_kit" })), /does not match/);
  assert.throws(() => diff({ status: "not_found", provider: "mastodon_collection", setId: "collection-2", observedAt: T1 }), /does not match/);
  assert.throws(() => diff({ status: "not_found", provider: "loops_starter_kit", setId: "collection-1", observedAt: T1 }), /does not match/);
});

test("a stale read is refused rather than reported", () => {
  assert.throws(() => diff(found({ observedAt: "2026-10-01T09:59:59.000Z" })), RangeError);
  assert.throws(() => diff({ status: "not_found", provider: "mastodon_collection", setId: "collection-1", observedAt: "2026-10-01T09:00:00.000Z" }), RangeError);
  assert.equal(diff(found({ observedAt: T0 })).outcome, "unchanged");
});

test("oversized sets are refused on either side", () => {
  const many = Array.from({ length: MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS + 1 }, (_, i) => member(`m${i}`));
  assert.throws(() => diff(found({ members: many })), RangeError);
  assert.throws(() => diff(found(), curatedSet({ members: many })), RangeError);
  const exactly = many.slice(0, MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS);
  const report = diff(found({ members: [] }), curatedSet({ members: exactly }));
  assert.equal(report.events.length, MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS);
});

test("malformed inputs fail closed", () => {
  const bad = (value: unknown) => assert.throws(() => diffRecommendationCuratedAccountSet(value as never));
  bad(null);
  bad({ subjectId: "", previous: curatedSet(), fresh: { status: "unknown" } });
  bad({ subjectId: " s", previous: curatedSet(), fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: null, fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: curatedSet({ provider: "other" as never }), fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: curatedSet({ observedAt: "yesterday" }), fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: curatedSet({ discoverable: "yes" as never }), fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: curatedSet({ members: [{ accountId: "a", state: "maybe" as never }] }), fresh: { status: "unknown" } });
  bad({ subjectId: "s", previous: curatedSet(), fresh: undefined });
  bad({ subjectId: "s", previous: curatedSet(), fresh: { status: "deleted" } });
  bad({ subjectId: "s", previous: curatedSet(), fresh: { status: "found", set: null } });
  bad({ subjectId: "s", previous: curatedSet(), fresh: { status: "not_found", provider: "mastodon_collection", setId: "collection-1", observedAt: "nope" } });
  bad({ subjectId: "s", previous: curatedSet(), fresh: { status: "found", set: curatedSet({ observedAt: "2026-10-01T10:05:00" }) } });
});

test("the diff never reports anything for another set's source ID", () => {
  const events = [
    ...diff(found({ discoverable: false })).events,
    ...diff({ status: "not_found", provider: "mastodon_collection", setId: "collection-1", observedAt: T1 }).events,
    ...diff(found({ members: [member("alice", "revoked")] })).events
  ];
  assert.ok(events.every((e) => e.setSourceId === SOURCE_ID));
  assert.notEqual(SOURCE_ID, createRecommendationCuratedAccountSetSourceId("mastodon_collection", "collection-2"));
});

function packPlan(): RecommendationCandidateActionPlan {
  const nativeId = "https://example.test/starter_pack/1";
  const pack: RecommendationCandidate = {
    candidateId: createRecommendationCandidateId({ kind: "starter_pack", protocol: "activitypub", nativeId, provider: "example.test" }),
    kind: "starter_pack", protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: MEMBER_OBSERVED_AT },
    availability: "available", observedAt: MEMBER_OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "test-source", observedAt: MEMBER_OBSERVED_AT, trustBoundary: "same_provider" }]
  };
  const account = (name: string): RecommendationCandidate => {
    const uri = `https://example.test/users/${name}`;
    return {
      ...pack, kind: "account", nativeId: uri,
      candidateId: createRecommendationCandidateId({ kind: "account", protocol: "activitypub", nativeId: uri, provider: "example.test" }),
      verification: { state: "authority_verified", authority: uri, verifiedAt: MEMBER_OBSERVED_AT }
    };
  };
  return createRecommendationCandidateActionPlan({
    candidate: pack,
    eligibility: { candidate: pack, eligible: true, reasonCodes: ["eligible"], evaluatedAt: "2026-09-26T06:01:00.000Z" },
    provider: actionProvider("starter_pack"), createdAt: "2026-09-26T06:02:00.000Z",
    starterPackMembers: ["alice", "bob"].map((name) => starterPackMember(account(name), `id-${name}`))
  });
}

test("reported set events exclude the set and invalidate a plan that relied on it", () => {
  const report = diff({ status: "not_found", provider: "mastodon_collection", setId: "collection-1", observedAt: T1 });
  assert.deepEqual(listRecommendationLifecycleExcludedSetSourceIds(report.events), [SOURCE_ID]);
  const assessment = assessRecommendationCandidateActionPlan(packPlan(), report.events, { now: "2026-10-01T10:10:00.000Z" });
  assert.equal(assessment.state, "invalid");
  assert.equal(assessment.usable, false);
});

test("a revoked member reported by the diff invalidates the plan that included that member", () => {
  const report = diff(found({ members: [member("alice", "revoked"), member("bob")] }));
  const assessment = assessRecommendationCandidateActionPlan(packPlan(), report.events, { now: "2026-10-01T10:10:00.000Z" });
  assert.equal(assessment.state, "invalid");
  assert.ok(assessment.affectedMemberCandidateIds.includes(candidateId("alice")));
});
