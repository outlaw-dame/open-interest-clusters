import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateActionPlan,
  createRecommendationCuratedAccountSetCandidateSourceAdapter,
  createRecommendationCuratedAccountSetSourceId,
  evaluateRecommendationCandidateEligibility,
  readRecommendationCandidateSourceAdapter,
  type RecommendationCandidate,
  type RecommendationCandidateKind,
  type RecommendationCuratedAccountMember,
  type RecommendationCuratedAccountSet,
  type RecommendationProviderDescriptor
} from "../src/index.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";

function member(name: string, state: RecommendationCuratedAccountMember["state"] = "accepted"): RecommendationCuratedAccountMember {
  return { accountId: `acct-${name}`, accountUri: `https://social.example/users/${name}`, handle: `${name}@social.example`, state };
}

function set(overrides: Partial<RecommendationCuratedAccountSet> = {}): RecommendationCuratedAccountSet {
  return {
    provider: "mastodon_collection",
    id: "collection-1",
    url: "https://social.example/collections/collection-1",
    curatorId: "curator-1",
    name: "PlayStation people",
    description: "Folks who post about PlayStation",
    discoverable: true,
    sensitive: false,
    observedAt: OBSERVED_AT,
    hashtags: ["playstation", "gaming"],
    members: [member("alice"), member("bob")],
    trustBoundary: "same_provider",
    membershipComplete: true,
    ...overrides
  };
}

async function read(sets: readonly RecommendationCuratedAccountSet[], kinds: readonly RecommendationCandidateKind[] = ["account", "starter_pack"]) {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets });
  return (await readRecommendationCandidateSourceAdapter(adapter, {
    requestId: "read",
    candidateKinds: kinds,
    canonicalInterestIds: [],
    limit: 500
  })).candidates;
}

const packs = (candidates: readonly RecommendationCandidate[]) => candidates.filter((candidate) => candidate.kind === "starter_pack");

test("a qualifying set becomes one source-asserted starter-pack candidate bound to its provider and set", async () => {
  const [pack, ...rest] = packs(await read([set()]));
  assert.equal(rest.length, 0);
  assert.ok(pack);
  assert.equal(pack.protocol, "activitypub");
  assert.equal(pack.nativeId, "https://social.example/collections/collection-1");
  assert.equal(pack.provider, "social.example");
  assert.equal(pack.uri, pack.nativeId);
  assert.equal(pack.verification.state, "source_asserted");
  assert.equal(pack.availability, "unknown");
  assert.equal(pack.metadata.displayName, "PlayStation people");
  assert.equal(pack.metadata.summary, "Folks who post about PlayStation");
  assert.deepEqual(pack.metadata.tags, ["gaming", "playstation"]);
  assert.deepEqual(pack.provenance, [{
    kind: "curated_account_set",
    sourceId: createRecommendationCuratedAccountSetSourceId("mastodon_collection", "collection-1"),
    sourceItemId: "collection-1",
    curator: "curator-1",
    sourceUrl: "https://social.example/collections/collection-1",
    observedAt: OBSERVED_AT,
    trustBoundary: "same_provider"
  }]);
});

test("the pack does not copy the member list, and accepted members still come out as account candidates", async () => {
  const all = await read([set({ members: [member("alice"), member("bob"), member("carol", "pending")] })]);
  const pack = packs(all)[0];
  assert.ok(pack);
  assert.equal(JSON.stringify(pack).includes("alice"), false);
  assert.equal(JSON.stringify(pack).includes("carol"), false);
  const accounts = all.filter((candidate) => candidate.kind === "account").map((candidate) => candidate.nativeId).sort();
  assert.deepEqual(accounts, ["https://social.example/users/alice", "https://social.example/users/bob"]);
  assert.equal(new Set(all.map((candidate) => candidate.candidateId)).size, all.length);
});

test("the source only returns the kinds the caller asked for", async () => {
  const onlyPacks = await read([set()], ["starter_pack"]);
  assert.deepEqual(onlyPacks.map((candidate) => candidate.kind), ["starter_pack"]);
  const onlyAccounts = await read([set()], ["account"]);
  assert.equal(onlyAccounts.every((candidate) => candidate.kind === "account"), true);
  assert.equal((await read([set()], ["feed"])).length, 0);
});

test("sets that are not discoverable or are sensitive produce no pack", async () => {
  assert.equal((await read([set({ discoverable: false })])).length, 0);
  assert.equal((await read([set({ sensitive: true })])).length, 0);
});

test("empty and all-non-accepted sets produce no pack", async () => {
  assert.equal(packs(await read([set({ members: [] })])).length, 0);
  const nonAccepted = (["pending", "rejected", "revoked", "unknown"] as const).map((state) => member(state, state));
  assert.equal((await read([set({ members: nonAccepted })])).length, 0);
  const noUri: RecommendationCuratedAccountMember = { accountId: "acct-x", state: "accepted" };
  assert.equal(packs(await read([set({ members: [noUri] })])).length, 0);
});

test("a set is counted by accepted members only, up to the 150 member cap", async () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => member(`user${index}`));
  assert.equal(packs(await read([set({ members: many(150) })])).length, 1);
  assert.equal(packs(await read([set({ members: many(151) })])).length, 0);
  const mixed = [...many(150), ...Array.from({ length: 20 }, (_, index) => member(`pending${index}`, "pending"))];
  assert.equal(packs(await read([set({ members: mixed })])).length, 1);
});

test("malformed set URLs and IDs fail closed instead of producing a pack", async () => {
  for (const url of ["not a url", "http://social.example/collections/1", "https://user:pw@social.example/collections/1"]) {
    await assert.rejects(read([set({ url })]), TypeError);
  }
  await assert.rejects(read([set({ id: " padded " })]), TypeError);
  await assert.rejects(read([set({ id: "bad\u0000id" })]), TypeError);
});

test("output is deterministic regardless of input order", async () => {
  const a = set();
  const b = set({ id: "collection-2", url: "https://other.example/collections/collection-2", members: [member("dave")] });
  const forward = await read([a, b]);
  const backward = await read([b, a]);
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward.map((candidate) => candidate.candidateId), [...forward.map((candidate) => candidate.candidateId)].sort());
});

test("the same set read twice collapses into one pack that keeps the newest observation", async () => {
  const later = "2026-09-26T07:00:00.000Z";
  const [pack, ...rest] = packs(await read([set(), set({ observedAt: later })]));
  assert.equal(rest.length, 0);
  assert.ok(pack);
  assert.equal(pack.observedAt, later);
  assert.equal(pack.provenance.length, 1);
  assert.equal(pack.provenance[0]?.observedAt, later);
  assert.equal(pack.metadata.summary, "Folks who post about PlayStation");
});

test("two sets on one provider give two packs, and the same member still collapses to one account", async () => {
  const all = await read([set(), set({ id: "collection-2", url: "https://social.example/collections/collection-2" })]);
  assert.equal(packs(all).length, 2);
  const alice = all.filter((candidate) => candidate.nativeId === "https://social.example/users/alice");
  assert.equal(alice.length, 1);
  assert.equal(alice[0]?.provenance.length, 2);
});

test("remote-provider sets keep their trust boundary on the pack", async () => {
  const pack = packs(await read([set({ trustBoundary: "remote_provider" })]))[0];
  assert.equal(pack?.provenance[0]?.trustBoundary, "remote_provider");
  assert.equal(pack?.verification.state, "source_asserted");
});

test("loops and pixelfed sets use the same pack shape", async () => {
  const loops = set({ provider: "loops_starter_kit", id: "kit-1", url: "https://loops.example/starter-kits/kit-1" });
  const pack = packs(await read([loops]))[0];
  assert.equal(pack?.provider, "loops.example");
  assert.equal(pack?.provenance[0]?.sourceId, createRecommendationCuratedAccountSetSourceId("loops_starter_kit", "kit-1"));
});

function providerFor(host: string, withStarterPacks: boolean, state: "supported" | "unsupported" | "unknown" = "supported"): RecommendationProviderDescriptor {
  return {
    providerId: host,
    detectedAt: "2026-09-26T05:59:00.000Z",
    expiresAt: "2026-09-26T07:00:00.000Z",
    protocolBindings: [{ protocol: "activitypub", authority: "protocol_native", verification: "verified" }],
    applicationProfiles: [],
    capabilities: withStarterPacks ? [{ capability: "starter_packs", state, authority: "protocol_native", protocol: "activitypub" }] : []
  };
}

async function eligibilityFor(candidate: RecommendationCandidate) {
  return evaluateRecommendationCandidateEligibility({
    candidate,
    evidence: { kind: "starter_pack", resolvable: true, current: true, available: true, memberCount: 2 },
    evaluateProviderPolicy: () => ({ allowed: true, evidenceComplete: true }),
    evaluateViewerSafety: () => ({ eligible: true, evidenceComplete: true }),
    evaluatedAt: EVALUATED_AT
  });
}

/** What the app does once the hosting provider has confirmed the set. The source never does this itself. */
function providerVerified(candidate: RecommendationCandidate): RecommendationCandidate {
  return { ...candidate, verification: { state: "authority_verified", authority: "social.example", verifiedAt: EVALUATED_AT }, availability: "available" };
}

async function memberInput(account: RecommendationCandidate) {
  return {
    eligibility: {
      candidate: account,
      eligible: true,
      reasonCodes: ["eligible"] as const,
      evaluatedAt: EVALUATED_AT,
      resolvedAccount: { id: account.provenance[0]?.sourceItemId ?? "", uri: account.nativeId }
    },
    consent: { state: "accepted" as const, setProvider: "mastodon_collection", setId: "collection-1", observedAt: OBSERVED_AT }
  };
}

test("end to end: source, eligibility, and plan for a Mastodon Collection pack", async () => {
  const all = await read([set()]);
  const sourced = packs(all)[0];
  assert.ok(sourced);

  const unverified = await eligibilityFor(sourced);
  assert.equal(unverified.eligible, false);
  assert.deepEqual(unverified.reasonCodes, ["identity_verification_required"]);

  const pack = providerVerified(sourced);
  const eligibility = await eligibilityFor(pack);
  assert.equal(eligibility.eligible, true);

  const accounts = all.filter((candidate) => candidate.kind === "account");
  const starterPackMembers = await Promise.all(accounts.map((account) => memberInput(account)));
  const plan = createRecommendationCandidateActionPlan({
    candidate: pack,
    eligibility,
    provider: providerFor("social.example", true),
    createdAt: CREATED_AT,
    starterPackMembers
  });

  assert.equal(plan.action, "expand_starter_pack");
  assert.equal(plan.executable, false);
  assert.equal(plan.requiresExplicitUserConfirmation, true);
  assert.equal(plan.members?.length, 2);
  const expectedSource = createRecommendationCuratedAccountSetSourceId("mastodon_collection", "collection-1");
  for (const bound of plan.members ?? []) {
    assert.equal(bound.consentState, "accepted");
    assert.equal(bound.consentSetSourceId, expectedSource);
  }
});

test("the plan fails closed when the provider has no starter_packs capability", async () => {
  const pack = providerVerified(packs(await read([set()]))[0] as RecommendationCandidate);
  const eligibility = await eligibilityFor(pack);
  const accounts = (await read([set()])).filter((candidate) => candidate.kind === "account");
  const starterPackMembers = await Promise.all(accounts.map((account) => memberInput(account)));
  for (const provider of [providerFor("social.example", false), providerFor("social.example", true, "unsupported"), providerFor("social.example", true, "unknown")]) {
    assert.throws(
      () => createRecommendationCandidateActionPlan({ candidate: pack, eligibility, provider, createdAt: CREATED_AT, starterPackMembers }),
      /supported provider action capability/u
    );
  }
  assert.throws(
    () => createRecommendationCandidateActionPlan({ candidate: pack, eligibility, provider: providerFor("elsewhere.example", true), createdAt: CREATED_AT, starterPackMembers }),
    /matching provider capability/u
  );
});

test("the plan rejects a member whose set consent does not match the set it came from", async () => {
  const all = await read([set({ members: [member("alice"), member("bob", "pending")] })]);
  const pack = providerVerified(packs(all)[0] as RecommendationCandidate);
  const eligibility = await eligibilityFor(pack);
  const alice = all.find((candidate) => candidate.kind === "account") as RecommendationCandidate;
  const input = await memberInput(alice);
  const pending = { ...input, consent: { ...input.consent, state: "pending" as const } };
  assert.throws(
    () => createRecommendationCandidateActionPlan({ candidate: pack, eligibility, provider: providerFor("social.example", true), createdAt: CREATED_AT, starterPackMembers: [pending] }),
    /accepted membership consent/u
  );
  const wrongSet = { ...input, consent: { ...input.consent, setId: "collection-9" } };
  assert.throws(
    () => createRecommendationCandidateActionPlan({ candidate: pack, eligibility, provider: providerFor("social.example", true), createdAt: CREATED_AT, starterPackMembers: [wrongSet] }),
    /must match curated-set provenance/u
  );
});
