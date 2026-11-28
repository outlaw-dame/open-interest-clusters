import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationProfilePersistenceTransitionError,
  transitionRecommendationProfilePersistence,
  createInMemoryRecommendationCandidateEventStore,
  createRecommendationProfileSubjectKey
} from "../src/index.js";
import { DEVICE_MANIFEST, POD_MANIFEST, REFERENCE_SUBJECT_ID, createInMemoryProfileAdapter } from "../examples/fakes.js";
import { checkPlacement, moveProfileToDevice, moveProfileToPod } from "../examples/device-to-pod.js";
import { HOUR_MS, collection, setup } from "./phase8-reference-fixtures.js";

const NO_WAIT = { sleep: async () => undefined, random: () => 0 };
const SUBJECT_KEY = createRecommendationProfileSubjectKey({ subjectId: REFERENCE_SUBJECT_ID });

async function onDevice(options: Parameters<typeof setup>[0] = {}) {
  const fixture = setup(options);
  const device = createInMemoryProfileAdapter(DEVICE_MANIFEST);
  const pod = createInMemoryProfileAdapter(POD_MANIFEST);
  await fixture.onboarding.select(["gaming"]);
  await fixture.onboarding.persistProfile(device);
  return { ...fixture, device, pod, locations: { device: { adapter: device }, pod: { adapter: pod } } };
}

test("the profile is saved on the device by default and the record keeps the device-only label", async () => {
  const { device } = await onDevice();
  const stored = device.records.get(SUBJECT_KEY);
  assert.ok(stored);
  assert.ok(stored.profile.entries.length > 0);
  assert.ok(stored.profile.entries.every((entry) => entry.privacyBoundaries.every((boundary) => boundary === "local_only")));
});

test("moving to a pod needs the user's server-side consent, and a refusal leaves the device copy alone", async () => {
  const { onboarding, device, pod, locations } = await onDevice();
  await assert.rejects(moveProfileToPod({ onboarding, ...locations, retry: NO_WAIT }));
  assert.ok(device.records.has(SUBJECT_KEY));
  assert.deepEqual(pod.log.filter((call) => call !== "read"), [], "nothing was written to or deleted from the pod");
  assert.equal(pod.records.size, 0);
  assert.equal(device.log.includes("delete"), false);
});

test("with consent the profile moves to the pod, is relabelled server_allowed, and can come back without server consent", async () => {
  const { onboarding, device, pod, locations } = await onDevice();
  onboarding.allowServerSideProcessing();
  const moved = await moveProfileToPod({ onboarding, ...locations, retry: NO_WAIT });
  assert.equal(moved.outcome, "moved");
  assert.equal(device.records.has(SUBJECT_KEY), false);
  const inPod = pod.records.get(SUBJECT_KEY);
  assert.ok(inPod && inPod.profile.entries.every((entry) => entry.privacyBoundaries.every((boundary) => boundary === "server_allowed")));

  // Edits after the move use the pod target and still work.
  const edited = await onboarding.select(["technology"]);
  assert.ok(edited.removed.includes("canonical_interest:gaming"));

  // Revoking consent clears the live signals. Going back to the device does not need server consent.
  await onboarding.withdraw("consent_revoked");
  const back = await moveProfileToDevice({ onboarding, ...locations, retry: NO_WAIT });
  assert.equal(back.outcome, "moved");
  assert.ok(device.records.has(SUBJECT_KEY));
  assert.equal(pod.records.has(SUBJECT_KEY), false);
});

test("a local_only label is refused for a pod destination and the device copy stays", async () => {
  const { onboarding, device, pod } = await onDevice();
  onboarding.allowServerSideProcessing();
  await assert.rejects(transitionRecommendationProfilePersistence({
    subjectId: REFERENCE_SUBJECT_ID,
    from: { adapter: device, storageTarget: "local_app" },
    to: { adapter: pod, storageTarget: "user_pod" },
    policy: onboarding.policy(),
    privacyBoundary: "local_only",
    retry: NO_WAIT
  }));
  assert.ok(device.records.has(SUBJECT_KEY));
  assert.equal(pod.records.size, 0);
});

test("a failed destination write is retried with backoff, then reported, and the device copy survives", async () => {
  const { onboarding, device, pod, locations } = await onDevice();
  onboarding.allowServerSideProcessing();
  const sleeps: number[] = [];
  const retry = { sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5 };

  pod.failWrites = 1;
  const recovered = await moveProfileToPod({ onboarding, ...locations, retry });
  assert.equal(recovered.outcome, "moved");
  assert.equal(sleeps.length, 1, "one failure, one wait");
  assert.ok(pod.records.has(SUBJECT_KEY));

  // Start again from the device and make every attempt fail.
  await moveProfileToDevice({ onboarding, ...locations, retry });
  pod.failWrites = 99;
  sleeps.length = 0;
  await assert.rejects(moveProfileToPod({ onboarding, ...locations, retry }));
  assert.ok(device.records.has(SUBJECT_KEY), "the device still holds the profile");
  assert.equal(pod.records.has(SUBJECT_KEY), false);
  assert.ok(sleeps.length >= 2 && sleeps.every((value, index) => index === 0 || value >= (sleeps[index - 1] ?? 0)), "waits do not shrink");
});

test("when only the source delete fails, the move reports cleanup pending and the same call finishes it", async () => {
  const { onboarding, device, pod, locations } = await onDevice();
  onboarding.allowServerSideProcessing();
  device.failDeletes = 99;
  await assert.rejects(moveProfileToPod({ onboarding, ...locations, retry: NO_WAIT }), (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_cleanup_pending");
  assert.ok(pod.records.has(SUBJECT_KEY) && device.records.has(SUBJECT_KEY), "both copies exist, so nothing was lost");

  device.failDeletes = 0;
  const finished = await moveProfileToPod({ onboarding, ...locations, retry: NO_WAIT });
  assert.ok(finished.outcome === "moved" || finished.outcome === "kept_newer_destination" || finished.outcome === "already_moved");
  assert.equal(device.records.has(SUBJECT_KEY), false);
  assert.ok(pod.records.has(SUBJECT_KEY));
});

test("reported candidate events travel with the profile when both places have an event store", async () => {
  const set = collection("games", ["alice"]);
  const { onboarding, device, pod, clock } = await onDevice({ curatedSets: [set] });
  await onboarding.reportSetChange(set, { status: "not_found", provider: "mastodon_collection", setId: "games", observedAt: clock.advance(HOUR_MS) });
  onboarding.allowServerSideProcessing();
  const podEvents = createInMemoryRecommendationCandidateEventStore(POD_MANIFEST);
  const result = await moveProfileToPod({ onboarding, device: { adapter: device, candidateEventStore: onboarding.eventStore }, pod: { adapter: pod, candidateEventStore: podEvents }, retry: NO_WAIT });
  assert.equal(result.candidateEvents, "moved");
  assert.ok(await podEvents.load(REFERENCE_SUBJECT_ID));
  assert.equal(await onboarding.eventStore.load(REFERENCE_SUBJECT_ID), undefined, "the device copy of the events is gone");
});

test("provider-owned, shared-operator and publicly readable placements are refused", async () => {
  const providerOwned = { ...POD_MANIFEST, adapterId: "provider", authority: "provider_owned" as const };
  const sharedOperator = { ...POD_MANIFEST, adapterId: "operator", authority: "shared_operator" as const };
  const publicRepo = { ...POD_MANIFEST, adapterId: "public-atproto-repo", publiclyReadable: true };
  for (const manifest of [providerOwned, sharedOperator, publicRepo]) {
    const check = checkPlacement(manifest);
    assert.equal(check.allowed, false, manifest.adapterId);
    assert.ok(check.refusedBecause.length > 0);
  }
  assert.deepEqual(checkPlacement(publicRepo).refusedBecause, ["state.deny.publicly_readable_store"]);
  assert.equal(checkPlacement(DEVICE_MANIFEST).allowed, true);
  assert.equal(checkPlacement(POD_MANIFEST).allowed, true);

  // The same refusals hold where data would actually be written.
  const { onboarding, device } = await onDevice();
  onboarding.allowServerSideProcessing();
  for (const manifest of [providerOwned, sharedOperator]) {
    const rogue = createInMemoryProfileAdapter(manifest);
    await assert.rejects(onboarding.persistProfile(rogue));
    await assert.rejects(moveProfileToPod({ onboarding, device: { adapter: device }, pod: { adapter: rogue }, retry: NO_WAIT }));
    assert.equal(rogue.records.size, 0);
    assert.equal(rogue.log.includes("write"), false);
  }
  assert.ok(device.records.has(SUBJECT_KEY), "a refused move leaves the device copy");
  assert.throws(() => setup({ extra: { candidateEventStore: createInMemoryRecommendationCandidateEventStore(providerOwned) } }), "a provider-owned event store is refused");
});

test("deleting everything removes the profile from every adapter that holds it", async () => {
  const { onboarding, device, pod, locations } = await onDevice();
  onboarding.allowServerSideProcessing();
  await moveProfileToPod({ onboarding, ...locations, retry: NO_WAIT });
  await onboarding.persistProfile(device);
  assert.equal(device.records.size + pod.records.size, 2, "a stray copy on each side");
  await onboarding.deleteEverything([device, pod]);
  assert.equal(device.records.size, 0);
  assert.equal(pod.records.size, 0);
  assert.equal((await onboarding.engine.readProfile(REFERENCE_SUBJECT_ID)).entries.length, 0);
});
