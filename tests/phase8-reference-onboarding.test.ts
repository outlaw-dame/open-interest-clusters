import test from "node:test";
import assert from "node:assert/strict";
import { RecommendationConsentDeniedError, createRecommendationCuratedAccountSetSourceId } from "../src/index.js";
import { ReferenceConfirmationError } from "../examples/onboarding-flow.js";
import { createFakeProviderDescriptor } from "../examples/fakes.js";
import { DAY_MS, HOUR_MS, T0, collection, setup } from "./phase8-reference-fixtures.js";

const names = (view: { items: readonly { recommendation: { candidate: { nativeId: string } } }[] }) =>
  view.items.map((item) => item.recommendation.candidate.nativeId.split("/").pop()).sort();

test("cold start: nothing is suggested before the user picks, and picks make suggestions appear", async () => {
  const { onboarding } = setup();
  const empty = await onboarding.recommend("first-run");
  assert.equal(empty.session.state, "no_picks");
  assert.deepEqual(empty.items, []);

  const written = await onboarding.select(["gaming"]);
  assert.ok(written.added.includes("canonical_interest:gaming"));
  const view = await onboarding.recommend("after-pick");
  assert.deepEqual(names(view), ["dana", "frank"]);
  assert.equal(view.session.state, "ready");
});

test("an account a third party only hinted at is suggested without a verified badge and with a plain caveat", async () => {
  const { onboarding } = setup();
  await onboarding.select(["gaming"]);
  const view = await onboarding.recommend("r1");
  const frank = view.items.find((item) => item.recommendation.candidate.nativeId.endsWith("/frank"));
  assert.equal(frank?.evidence.showVerifiedBadge, false);
  assert.equal(frank?.evidence.state, "source_asserted");
  assert.match(frank?.evidence.text ?? "", /Not checked/u);
  assert.equal(frank?.reason.copyKey, "directory_hint_topic");
  assert.match(frank?.reason.text ?? "", /We have not checked it/u);
  const dana = view.items.find((item) => item.recommendation.candidate.nativeId.endsWith("/dana"));
  assert.equal(dana?.evidence.showVerifiedBadge, true);
});

test("each suggestion carries a reason built from the user's pick and its provenance, plus an honest evidence label", async () => {
  const { onboarding } = setup({ curatedSets: [collection("games", ["alice", "bob"])] });
  await onboarding.select(["gaming"]);
  const view = await onboarding.recommend("r1");
  const dana = view.items.find((item) => item.recommendation.candidate.nativeId.endsWith("/dana"));
  assert.equal(dana?.reason.copyKey, "picked_topic");
  assert.match(dana?.reason.text ?? "", /you picked Gaming/u);
  assert.equal(dana?.evidence.showVerifiedBadge, true);
  assert.match(dana?.evidence.text ?? "", /Confirmed with social\.example/u);
  const alice = view.items.find((item) => item.recommendation.candidate.nativeId.endsWith("/alice"));
  assert.equal(alice?.reason.copyKey, "picked_topic_and_set");
  assert.match(alice?.reason.text ?? "", /collection about it/u);
  // The engine's own summary is generic and is not what the user reads.
  assert.ok(view.items.every((item) => !item.reason.text.includes(item.recommendation.explanation?.summary ?? "\u0000")));
});

test("a single-account plan is frozen and not executable, and confirming it is the only thing that contacts the provider", async () => {
  const { onboarding, provider } = setup();
  await onboarding.select(["gaming"]);
  const item = (await onboarding.recommend("r1")).items.find((entry) => entry.recommendation.candidate.nativeId.endsWith("/dana"));
  assert.ok(item);
  const { plan, view } = await onboarding.plan(item.recommendation.candidate);
  assert.equal(plan.executable, false);
  assert.equal(plan.requiresExplicitUserConfirmation, true);
  assert.ok(Object.isFrozen(plan));
  assert.equal(view.title, "Follow dana");
  assert.equal(view.blockedReason, undefined);
  assert.equal(provider.requests.length, 0, "making a plan sends nothing");

  await assert.rejects(onboarding.confirm(plan, { confirmed: false }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "not_confirmed");
  assert.equal(provider.requests.length, 0, "an unconfirmed plan sends nothing");

  const done = await onboarding.confirm(plan, { confirmed: true });
  assert.deepEqual(done.applied, [item.recommendation.candidate.nativeId]);
  assert.equal(provider.mutationCount, 1);
});

test("a Mastodon-Collection style set becomes a starter-pack plan with only accepted members", async () => {
  const set = collection("games", ["alice", "bob", ["carol", "pending"], ["dave", "revoked"]]);
  const { onboarding, provider } = setup({ curatedSets: [set] });
  await onboarding.select(["gaming"]);
  const view = await onboarding.recommend("r1");
  const pack = view.items.find((item) => item.recommendation.candidate.kind === "starter_pack");
  assert.ok(pack, "the collection is offered as a starter pack");
  const { plan, view: planView } = await onboarding.plan(pack.recommendation.candidate);
  assert.equal(plan.action, "expand_starter_pack");
  assert.deepEqual((plan.members ?? []).map((member) => member.accountUri).sort(), ["https://social.example/users/alice", "https://social.example/users/bob"]);
  assert.ok((plan.members ?? []).every((member) => member.consentState === "accepted" && member.consentSetSourceId === createRecommendationCuratedAccountSetSourceId("mastodon_collection", "games")));
  assert.equal(planView.title, "Follow these 2 accounts from Collection games");

  // The user unticks one member before confirming.
  const bob = (plan.members ?? []).find((member) => member.accountUri.endsWith("/bob"));
  const done = await onboarding.confirm(plan, { confirmed: true, excludeMemberCandidateIds: [bob?.candidateId ?? ""] });
  assert.deepEqual(done.applied, ["https://social.example/users/alice"]);
  assert.equal(provider.requests.length, 1);
});

test("a member who is not eligible any more is left out of a new plan and reported", async () => {
  const { onboarding, resolver } = setup({ curatedSets: [collection("games", ["alice", "bob"])] });
  await onboarding.select(["gaming"]);
  const pack = (await onboarding.recommend("r1")).items.find((item) => item.recommendation.candidate.kind === "starter_pack");
  assert.ok(pack);
  resolver.gone.add("https://social.example/users/bob");
  const { plan, leftOutCandidateIds } = await onboarding.plan(pack.recommendation.candidate);
  assert.deepEqual((plan.members ?? []).map((member) => member.accountUri), ["https://social.example/users/alice"]);
  assert.equal(leftOutCandidateIds.length, 1);
});

test("confirming revalidates: an account that disappeared and a stale plan are both refused", async () => {
  const { onboarding, provider, resolver, clock } = setup();
  await onboarding.select(["gaming"]);
  const candidate = (await onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(candidate);

  // The account is gone by the time the user says yes.
  const first = (await onboarding.plan(candidate)).plan;
  resolver.gone.add(candidate.nativeId);
  await assert.rejects(onboarding.confirm(first, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "eligibility_changed");
  resolver.gone.clear();

  // Eligibility older than a day makes the plan stale.
  const second = (await onboarding.plan(candidate)).plan;
  clock.advance(DAY_MS + HOUR_MS);
  await assert.rejects(onboarding.confirm(second, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "plan_stale");

  assert.equal(provider.requests.length, 0, "no refused plan reached the provider");
});

test("a plan whose capability window ran out is stale, and a provider that dropped the capability is refused on confirm", async () => {
  const short = setup({ providerTtlMs: 2 * HOUR_MS });
  await short.onboarding.select(["gaming"]);
  const candidate = (await short.onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(candidate);
  const { plan } = await short.onboarding.plan(candidate);
  short.clock.advance(3 * HOUR_MS);
  await assert.rejects(short.onboarding.confirm(plan, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "plan_stale");
  await assert.rejects(short.onboarding.plan(candidate), /fresh provider capability/u, "a new plan cannot be made from expired capability evidence");
  assert.equal(short.provider.requests.length, 0);

  let dropped = false;
  const base = createFakeProviderDescriptor(new Date(Date.parse(T0) - HOUR_MS).toISOString(), new Date(Date.parse(T0) + DAY_MS).toISOString());
  const live = setup({ extra: { describeProvider: () => (dropped ? { ...base, capabilities: [] } : base) } });
  await live.onboarding.select(["gaming"]);
  const target = (await live.onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(target);
  const made = await live.onboarding.plan(target);
  dropped = true;
  await assert.rejects(live.onboarding.confirm(made.plan, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "capability_expired");
  assert.equal(live.provider.requests.length, 0);
});

test("a failed provider call is reported as such and is not retried behind the user's back", async () => {
  const { onboarding, provider } = setup();
  await onboarding.select(["gaming"]);
  const candidate = (await onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(candidate);
  const { plan } = await onboarding.plan(candidate);
  provider.failNextMutations = 1;
  await assert.rejects(onboarding.confirm(plan, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "provider_failed");
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.mutationCount, 0);
});

test("editing picks retracts what was removed, and refresh follows the new picks", async () => {
  const { onboarding } = setup();
  await onboarding.select(["gaming", "technology"]);
  assert.deepEqual(names(await onboarding.recommend("r1")), ["dana", "erin", "frank"]);

  const edited = await onboarding.select(["technology"]);
  assert.ok(edited.removed.includes("canonical_interest:gaming"));
  assert.deepEqual(names(await onboarding.recommend("r2")), ["erin"]);

  const again = await onboarding.select(["technology"]);
  assert.equal(again.eventCount, 0, "the same picks write nothing");

  const cleared = await onboarding.withdraw("source_retracted");
  assert.ok(cleared.removed.length > 0);
  const after = await onboarding.recommend("r3");
  assert.equal(after.session.state, "no_picks");
});

test("a revoked consent stops new picks, clears stored events and leaves nothing live", async () => {
  const set = collection("games", ["alice", "bob"]);
  const { onboarding, clock } = setup({ curatedSets: [set] });
  await onboarding.select(["gaming"]);
  await onboarding.reportSetChange(set, { status: "not_found", provider: "mastodon_collection", setId: "games", observedAt: clock.advance(HOUR_MS) });
  assert.equal((await onboarding.lifecycle.listReportedCandidateEvents({ subjectId: onboarding.subjectId })).length, 1);

  await onboarding.withdraw("consent_revoked");
  assert.deepEqual(await onboarding.lifecycle.listReportedCandidateEvents({ subjectId: onboarding.subjectId }), []);
  assert.equal((await onboarding.engine.readProfile(onboarding.subjectId)).entries.length, 0);
  await assert.rejects(onboarding.select(["gaming"]), RecommendationConsentDeniedError);
});

test("a set that was deleted is reported, stored, and dropped from the next refresh and from plans", async () => {
  const set = collection("games", ["alice", "bob"]);
  const { onboarding, clock } = setup({ curatedSets: [set] });
  await onboarding.select(["gaming"]);
  const before = await onboarding.recommend("r1");
  const pack = before.items.find((item) => item.recommendation.candidate.kind === "starter_pack");
  assert.ok(pack);
  const { plan } = await onboarding.plan(pack.recommendation.candidate);

  const { report, reported } = await onboarding.reportSetChange(set, { status: "not_found", provider: "mastodon_collection", setId: "games", observedAt: clock.advance(HOUR_MS) });
  assert.equal(report.outcome, "changed");
  assert.equal(reported.acceptedEventCount, 1);
  assert.equal(reported.evidenceVerification, "unverified");

  const after = await onboarding.recommend("r2");
  assert.deepEqual(after.excludedSetSourceIds, [createRecommendationCuratedAccountSetSourceId("mastodon_collection", "games")]);
  assert.ok(!names(after).some((name) => name === "alice" || name === "bob"));
  assert.ok(!after.items.some((item) => item.recommendation.candidate.kind === "starter_pack"));
  await assert.rejects(onboarding.confirm(plan, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "plan_invalid");
});

test("a member who withdrew consent invalidates the plan, and an unknown read changes nothing", async () => {
  const set = collection("games", ["alice", "bob"]);
  const { onboarding, provider, clock } = setup({ curatedSets: [set] });
  await onboarding.select(["gaming"]);
  const pack = (await onboarding.recommend("r1")).items.find((item) => item.recommendation.candidate.kind === "starter_pack");
  assert.ok(pack);
  const { plan } = await onboarding.plan(pack.recommendation.candidate);

  const outage = await onboarding.reportSetChange(set, { status: "unknown" });
  assert.equal(outage.report.outcome, "unknown");
  assert.deepEqual(outage.report.events, []);
  assert.equal((await onboarding.lifecycle.assessPlan({ subjectId: onboarding.subjectId, plan, policy: onboarding.policy(), now: clock.now() })).state, "valid");

  const withoutBob = collection("games", ["alice"], { observedAt: clock.advance(HOUR_MS) });
  const change = await onboarding.reportSetChange(set, { status: "found", set: withoutBob });
  assert.equal(change.report.events.length, 1);
  await assert.rejects(onboarding.confirm(plan, { confirmed: true }), (error: unknown) => error instanceof ReferenceConfirmationError && error.reason === "plan_invalid");
  assert.equal(provider.requests.length, 0);
});

test("a source that fails leaves a partial result and the picks intact, and all sources failing says so", async () => {
  const { onboarding, directory } = setup({ curatedSets: [collection("games", ["alice"])] });
  await onboarding.select(["gaming"]);
  directory.failNextReads = 1;
  const partial = await onboarding.recommend("r1");
  assert.equal(partial.session.state, "partial");
  assert.equal(partial.result.sourceFailures.length, 1);
  assert.ok(partial.items.length > 0);

  const only = setup();
  await only.onboarding.select(["gaming"]);
  only.directory.failNextReads = 1;
  const failed = await only.onboarding.recommend("r1");
  assert.equal(failed.session.state, "all_failed");
  assert.deepEqual(failed.items, []);
  assert.ok((await only.onboarding.engine.readProfile(only.onboarding.subjectId)).entries.length > 0, "picks are kept");
});

test("sources with nothing to offer give the nothing-found state", async () => {
  const { onboarding } = setup({ directory: false });
  await onboarding.select(["gaming"]);
  assert.equal((await onboarding.recommend("r1")).session.state, "nothing_found");
});

test("deleting everything removes the profile and later writes hit the deletion barrier", async () => {
  const { onboarding } = setup();
  await onboarding.select(["gaming"]);
  await onboarding.deleteEverything([]);
  await assert.rejects(onboarding.select(["gaming"]), /deletion replay barrier/u);
});
