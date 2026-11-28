import test from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_SUBJECT_ID, createFakeProviderService, DEVICE_MANIFEST, POD_MANIFEST, createInMemoryProfileAdapter } from "../examples/fakes.js";
import { moveProfileToPod } from "../examples/device-to-pod.js";
import { HOUR_MS, collection, setup } from "./phase8-reference-fixtures.js";

/** Words that would only show up in a request if profile or signal content had leaked into it. */
const FORBIDDEN = [
  REFERENCE_SUBJECT_ID,
  "canonical_interest",
  "local_personalization",
  "onboarding:v1",
  "signal",
  "profile",
  "selectedTopicIds",
  "canonicalInterestIds",
  "languages",
  "Gaming"
];

test("nothing a fake provider, source or resolver receives contains profile or signal content", async () => {
  const set = collection("games", ["alice", "bob"]);
  const { onboarding, provider, resolver, directory, clock } = setup({ curatedSets: [set] });
  const device = createInMemoryProfileAdapter(DEVICE_MANIFEST);
  const pod = createInMemoryProfileAdapter(POD_MANIFEST);

  // Run every step that can reach a provider: pick, recommend, plan both kinds, confirm both, report, refresh, move.
  await onboarding.select(["gaming"]);
  await onboarding.persistProfile(device);
  const view = await onboarding.recommend("r1");
  const account = view.items.find((item) => item.recommendation.candidate.nativeId.endsWith("/dana"));
  const pack = view.items.find((item) => item.recommendation.candidate.kind === "starter_pack");
  assert.ok(account && pack);
  await onboarding.confirm((await onboarding.plan(account.recommendation.candidate)).plan, { confirmed: true });
  await onboarding.confirm((await onboarding.plan(pack.recommendation.candidate)).plan, { confirmed: true });
  await onboarding.reportSetChange(set, { status: "found", set: collection("games", ["alice"], { observedAt: clock.advance(HOUR_MS) }) });
  await onboarding.recommend("r2");
  onboarding.allowServerSideProcessing();
  await moveProfileToPod({ onboarding, device: { adapter: device }, pod: { adapter: pod }, retry: { sleep: async () => undefined } });

  // The checks are only worth something if the fakes were actually used.
  assert.equal(provider.requests.length, 2);
  assert.ok(directory.queries.length >= 2);
  assert.ok(resolver.requests.length > 0);

  const seen = JSON.stringify({ provider: provider.requests, queries: directory.queries, lookups: resolver.requests });
  for (const word of FORBIDDEN) assert.equal(seen.includes(word), false, `a request contained "${word}"`);

  // What did go out is what the user confirmed: identifiers only.
  for (const request of provider.requests as { action: string; providerId: string; candidateIds: string[]; targets: string[] }[]) {
    assert.deepEqual(Object.keys(request).sort(), ["action", "candidateIds", "providerId", "targets"]);
    assert.ok(request.targets.every((target) => target.startsWith("https://social.example/users/")));
  }
  for (const query of directory.queries as Record<string, unknown>[]) {
    assert.equal("canonicalInterestIds" in query, false, "a remote source gets no interests");
    assert.equal("languages" in query, false, "a remote source gets no language preferences");
    assert.match(String(query["requestId"]), /^candidate-query:v1:[0-9a-f]{64}$/u, "the request ID is hashed");
  }
});

test("a refused or unconfirmed step sends nothing at all", async () => {
  const { onboarding, provider, resolver } = setup();
  await onboarding.select(["gaming"]);
  const candidate = (await onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(candidate);
  const { plan } = await onboarding.plan(candidate);
  const lookupsBefore = resolver.requests.length;
  await assert.rejects(onboarding.confirm(plan, { confirmed: false }));
  assert.equal(provider.requests.length, 0);
  assert.equal(resolver.requests.length, lookupsBefore, "declining does not even check the account again");

  await onboarding.withdraw("consent_revoked");
  await assert.rejects(onboarding.confirm(plan, { confirmed: true }), /no_consent/u);
  assert.equal(provider.requests.length, 0);
});

test("the fake provider keeps a copy, so a later change to a request cannot rewrite what was recorded", async () => {
  const provider = createFakeProviderService();
  const request = { action: "follow_account", providerId: "social.example", candidateIds: ["c1"], targets: ["https://social.example/users/x"] };
  await provider.mutate(request);
  request.targets.push("https://social.example/users/tampered");
  assert.deepEqual((provider.requests[0] as { targets: string[] }).targets, ["https://social.example/users/x"]);
});
