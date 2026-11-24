import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationConsentDeniedError,
  RecommendationProfilePersistenceError,
  RecommendationProfilePersistenceTransitionError,
  buildRecommendationCandidateEventRecord,
  createInMemoryRecommendationCandidateEventStore,
  createRecommendationProfileStoreRecord,
  createRecommendationProfileSubjectKey,
  transitionRecommendationProfilePersistence,
  type RecommendationCandidateEventRecord,
  type RecommendationCandidateEventStore,
  type RecommendationConsentPolicy,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const SUBJECT = "user-123";
const NOW = new Date().toISOString();
const RECORDED = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const OCCURRED = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
const PROFILE_MANIFEST: RecommendationStateStorageAdapterManifest = { adapterId: "local", domains: ["interest_profile"], authority: "device_owned", processingBoundary: "local_only", persistence: "persistent", requiresNetwork: false, supportsOffline: true, userExportable: true, userDeletable: true, encryptedAtRest: false };
const POD_PROFILE_MANIFEST: RecommendationStateStorageAdapterManifest = { ...PROFILE_MANIFEST, adapterId: "pod", authority: "user_owned", processingBoundary: "server_allowed", requiresNetwork: true, supportsOffline: false };
const EVENT_LOCAL: RecommendationStateStorageAdapterManifest = { ...PROFILE_MANIFEST, adapterId: "events-local", domains: ["candidate_lifecycle_events"] };
const EVENT_POD: RecommendationStateStorageAdapterManifest = { ...POD_PROFILE_MANIFEST, adapterId: "events-pod", domains: ["candidate_lifecycle_events"] };
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"], serverSideDataUses: ["local_personalization"] };

const bobRevoked = { kind: "member_consent_revoked", occurredAt: OCCURRED, candidateId: "account:bob", setSourceId: "pack-1" } as const;
const setDeleted = { kind: "set_deleted", occurredAt: OCCURRED, setSourceId: "pack-1" } as const;
const carolDeleted = { kind: "account_deleted", occurredAt: OCCURRED, candidateId: "account:carol" } as const;

function snapshot(): RecommendationProfileSnapshot {
  const entry = { target: { kind: "canonical_interest" as const, key: "books.fiction" }, score: 0.75, confidence: 0.8, signalCount: 1, positiveSignalCount: 1, negativeSignalCount: 0, neutralSignalCount: 0, privacyBoundaries: ["local_only" as const], protocols: ["app_local" as const], sourceVisibilities: ["local_only" as const], updatedAt: "2026-10-01T00:00:00.000Z" };
  return { schemaVersion: "recommendation-profile.v1", updatedAt: "2026-10-01T00:00:00.000Z", signalCount: 1, entries: [entry] };
}

class ProfileAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  constructor(readonly storageManifest: RecommendationStateStorageAdapterManifest) {}
  async readProfileRecord(key: string) { return this.records.get(key) ?? null; }
  async writeProfileRecord(value: RecommendationProfileStoreRecord) { this.records.set(value.subjectKey, value); }
  async deleteProfileRecord(key: string) { this.records.delete(key); }
}

/** Wraps the in-memory store so a test can break specific calls and see what was called. */
function flakyStore(manifest: RecommendationStateStorageAdapterManifest) {
  const inner = createInMemoryRecommendationCandidateEventStore(manifest);
  const calls: string[] = [];
  const state = { failSaves: 0, failDeletes: 0, dropSaves: false, corruptReads: false };
  const store: RecommendationCandidateEventStore = {
    manifest,
    supportsCompareAndSet: true,
    async load(subjectId) {
      calls.push("load");
      const value = await inner.load(subjectId);
      return state.corruptReads && value !== undefined ? { ...(value as object), digest: "0".repeat(64) } : value;
    },
    async save(subjectId, record, options) {
      calls.push("save");
      if (state.failSaves > 0) { state.failSaves -= 1; throw new Error("secret store detail"); }
      if (!state.dropSaves) await inner.save(subjectId, record, options);
    },
    async delete(subjectId) {
      calls.push("delete");
      if (state.failDeletes > 0) { state.failDeletes -= 1; throw new Error("delete failed"); }
      await inner.delete(subjectId);
    }
  };
  return { store, inner, calls, state };
}

async function seed(store: RecommendationCandidateEventStore, events: readonly unknown[], subjectId = SUBJECT, recordedAt = RECORDED): Promise<RecommendationCandidateEventRecord> {
  const record = buildRecommendationCandidateEventRecord(subjectId, events.map((event) => ({ recordedAt, event: event as never })), recordedAt);
  await store.save(subjectId, record);
  return record;
}

function setup(options: { profile?: boolean } = {}) {
  const localProfile = new ProfileAdapter(PROFILE_MANIFEST);
  const podProfile = new ProfileAdapter(POD_PROFILE_MANIFEST);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  if (options.profile !== false) localProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  const local = flakyStore(EVENT_LOCAL);
  const pod = flakyStore(EVENT_POD);
  const run = (extra: Record<string, unknown> = {}) => transitionRecommendationProfilePersistence({
    subjectId: SUBJECT,
    from: { adapter: localProfile, storageTarget: "local_app", candidateEventStore: local.store },
    to: { adapter: podProfile, storageTarget: "user_pod", candidateEventStore: pod.store },
    policy: POLICY, now: NOW, retry: { sleep: async () => undefined, random: () => 0.5, maxAttempts: 3 }, ...extra
  });
  return { localProfile, podProfile, key, local, pod, run };
}

test("events move with the profile: copied, read back, and the source cleared last", async () => {
  const { local, pod, localProfile, key, run } = setup();
  await seed(local.store, [bobRevoked, setDeleted]);
  const result = await run();
  assert.deepEqual(result, { outcome: "moved", from: "local_app", to: "user_pod", candidateEvents: "moved" });
  const held = await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord;
  assert.equal(held.entries.length, 2);
  assert.ok(held.entries.every((entry) => entry.recordedAt === RECORDED), "original recording time is kept, so the retention clock does not restart");
  assert.equal(await local.inner.load(SUBJECT), undefined);
  assert.equal(localProfile.records.has(key), false);
  assert.ok(pod.calls.lastIndexOf("load") > pod.calls.indexOf("save"), "destination is read back after the write");
});

test("events merge into what the destination already holds and never drop it", async () => {
  const { local, pod, run } = setup();
  await seed(local.store, [bobRevoked]);
  await seed(pod.store, [carolDeleted]);
  await run();
  const held = await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord;
  assert.deepEqual(held.entries.map((entry) => entry.event.kind).sort(), ["account_deleted", "member_consent_revoked"]);
});

test("set-level exclusions older than the default retention survive a move with no limits passed", async () => {
  const { local, pod, run } = setup();
  const oldAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  await seed(local.store, [{ ...setDeleted, occurredAt: new Date(Date.parse(oldAt) - 1000).toISOString() }], SUBJECT, oldAt);
  await run();
  const held = await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord;
  assert.equal(held.entries.length, 1);
  assert.equal(held.entries[0]!.recordedAt, oldAt);
  assert.equal(await local.inner.load(SUBJECT), undefined, "source is only cleared after the copy holds the exclusion");
});

test("a longer-lived exclusion already at the destination is not dropped when new events are merged in", async () => {
  const { local, pod, run } = setup();
  const oldAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const older = { ...setDeleted, setSourceId: "pack-old", occurredAt: new Date(Date.parse(oldAt) - 1000).toISOString() };
  await seed(pod.store, [older], SUBJECT, oldAt);
  await seed(local.store, [bobRevoked]);
  await run();
  const held = await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord;
  assert.deepEqual(held.entries.map((entry) => entry.event.kind).sort(), ["member_consent_revoked", "set_deleted"]);
});

test("ordinary events older than the default retention also move when no limits are passed", async () => {
  const { local, pod, run } = setup();
  const oldAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await seed(local.store, [{ ...carolDeleted, occurredAt: new Date(Date.parse(oldAt) - 1000).toISOString() }], SUBJECT, oldAt);
  await run();
  assert.equal((await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord).entries.length, 1);
});

test("limits the caller passes still narrow what moves", async () => {
  const { local, pod, run } = setup();
  const oldAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  await seed(local.store, [{ ...setDeleted, occurredAt: new Date(Date.parse(oldAt) - 1000).toISOString() }], SUBJECT, oldAt);
  const day = 24 * 60 * 60 * 1000;
  await run({ candidateEventLimits: { retentionMs: day, setExclusionRetentionMs: day } });
  assert.equal(await pod.inner.load(SUBJECT), undefined, "an explicit short window is honoured");
});

test("a delete that fails leaves the source profile and events, and a rerun finishes without a duplicate", async () => {
  const { local, pod, localProfile, key, run } = setup();
  await seed(local.store, [bobRevoked]);
  local.state.failDeletes = 99;
  await assert.rejects(run(), (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_cleanup_pending");
  assert.ok(localProfile.records.has(key), "profile stays as the retry marker");
  assert.ok(await local.inner.load(SUBJECT));
  const savesAfterFailure = pod.calls.filter((call) => call === "save").length;
  assert.equal(savesAfterFailure, 1);
  local.state.failDeletes = 0;
  const finished = await run();
  assert.equal(finished.candidateEvents, "moved");
  assert.equal(pod.calls.filter((call) => call === "save").length, savesAfterFailure, "the retry does not write the destination again");
  assert.equal(await local.inner.load(SUBJECT), undefined);
  assert.equal(localProfile.records.has(key), false);
  const again = await run();
  assert.deepEqual([again.outcome, again.candidateEvents], ["already_moved", "nothing_to_move"]);
});

test("a failed destination write is retried with backoff and then succeeds", async () => {
  const { local, pod, run } = setup();
  await seed(local.store, [bobRevoked]);
  pod.state.failSaves = 2;
  const sleeps: number[] = [];
  const result = await run({ retry: { sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5, baseDelayMs: 100 } });
  assert.equal(result.candidateEvents, "moved");
  assert.deepEqual(sleeps, [50, 100]);
});

test("a destination that keeps failing leaves every source record in place", async () => {
  const { local, pod, localProfile, key, run } = setup();
  await seed(local.store, [bobRevoked]);
  pod.state.failSaves = 99;
  await assert.rejects(run(), (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.error.adapter_write_failed" && !/secret/u.test(String(error.message)));
  assert.ok(await local.inner.load(SUBJECT));
  assert.ok(localProfile.records.has(key));
  assert.equal(local.calls.includes("delete"), false);
});

test("a read-back mismatch keeps the source", async () => {
  const { local, pod, localProfile, key, run } = setup();
  await seed(local.store, [bobRevoked]);
  pod.state.dropSaves = true;
  await assert.rejects(run(), (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.error.write_verification_failed");
  assert.ok(await local.inner.load(SUBJECT));
  assert.ok(localProfile.records.has(key));
  assert.equal(local.calls.includes("delete"), false);
});

test("denied consent moves nothing, events included", async () => {
  for (const policy of [null, undefined, { ...POLICY, subjectId: "someone-else" }, { ...POLICY, revokedAt: "2026-10-01T12:00:00.000Z" }, { ...POLICY, serverSideDataUses: [] }] as const) {
    const { local, pod, localProfile, podProfile, key, run } = setup();
    await seed(local.store, [bobRevoked]);
    await assert.rejects(run({ policy }), (error: unknown) => error instanceof RecommendationProfilePersistenceError || error instanceof RecommendationConsentDeniedError);
    assert.ok(await local.inner.load(SUBJECT));
    assert.equal(pod.calls.length, 0);
    assert.equal(podProfile.records.has(key), false);
    assert.ok(localProfile.records.has(key));
  }
});

test("a rerun after the profile already moved still needs consent before events reach the pod", async () => {
  // The source profile is gone and the pod has one, so no profile write happens. The consent check
  // at the top of the transition is the only thing standing between the events and the pod store.
  for (const policy of [null, undefined, { ...POLICY, subjectId: "someone-else" }, { ...POLICY, revokedAt: "2026-10-01T12:00:00.000Z" }, { ...POLICY, serverSideDataUses: [] }] as const) {
    const { local, pod, podProfile, key, run } = setup({ profile: false });
    podProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
    await seed(local.store, [bobRevoked]);
    await assert.rejects(run({ policy }), (error: unknown) => error instanceof RecommendationProfilePersistenceError || error instanceof RecommendationConsentDeniedError);
    assert.ok(await local.inner.load(SUBJECT), "events stay at the source");
    assert.equal(pod.calls.length, 0, "the pod event store is never touched");
    assert.equal(await pod.inner.load(SUBJECT), undefined);
  }
  const { local, pod, podProfile, key, run } = setup({ profile: false });
  podProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  await seed(local.store, [bobRevoked]);
  const allowed = await run();
  assert.deepEqual([allowed.outcome, allowed.candidateEvents], ["already_moved", "moved"]);
  assert.ok(await pod.inner.load(SUBJECT));
});

test("moving back to the device needs no server consent", async () => {
  const localProfile = new ProfileAdapter(PROFILE_MANIFEST);
  const podProfile = new ProfileAdapter(POD_PROFILE_MANIFEST);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  podProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  const local = flakyStore(EVENT_LOCAL);
  const pod = flakyStore(EVENT_POD);
  await seed(pod.store, [bobRevoked]);
  const result = await transitionRecommendationProfilePersistence({
    subjectId: SUBJECT, policy: null, now: NOW,
    from: { adapter: podProfile, storageTarget: "user_pod", candidateEventStore: pod.store },
    to: { adapter: localProfile, storageTarget: "local_app", candidateEventStore: local.store }
  });
  assert.equal(result.candidateEvents, "moved");
  assert.ok(await local.inner.load(SUBJECT));
  assert.equal(await pod.inner.load(SUBJECT), undefined);
});

test("a store on only one side leaves events alone and says so", async () => {
  const localProfile = new ProfileAdapter(PROFILE_MANIFEST);
  const podProfile = new ProfileAdapter(POD_PROFILE_MANIFEST);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  localProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  const local = flakyStore(EVENT_LOCAL);
  await seed(local.store, [bobRevoked]);
  local.calls.length = 0;
  const result = await transitionRecommendationProfilePersistence({
    subjectId: SUBJECT, policy: POLICY, now: NOW,
    from: { adapter: localProfile, storageTarget: "local_app", candidateEventStore: local.store },
    to: { adapter: podProfile, storageTarget: "user_pod" }
  });
  assert.equal(result.candidateEvents, "skipped_store_missing");
  assert.equal(result.outcome, "moved");
  assert.ok(await local.inner.load(SUBJECT), "events stay where they were");
  assert.deepEqual(local.calls, []);
});

test("with no event stores the result has no candidateEvents field", async () => {
  const localProfile = new ProfileAdapter(PROFILE_MANIFEST);
  const podProfile = new ProfileAdapter(POD_PROFILE_MANIFEST);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  localProfile.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, policy: POLICY, now: NOW, from: { adapter: localProfile, storageTarget: "local_app" }, to: { adapter: podProfile, storageTarget: "user_pod" } });
  assert.equal("candidateEvents" in result, false);
});

test("a source record that fails validation stops the move before anything is written or deleted", async () => {
  const forged = buildRecommendationCandidateEventRecord("someone-else", [], RECORDED);
  const tampered = { ...buildRecommendationCandidateEventRecord(SUBJECT, [{ recordedAt: RECORDED, event: bobRevoked }], RECORDED), entries: [{ recordedAt: RECORDED, event: { ...bobRevoked, candidateId: "account:mallory" } }] };
  const injected = { ...forged, subjectId: SUBJECT, entries: [], __proto__: { polluted: true }, extra: "<script>" };
  for (const bad of [forged, tampered, injected, "text", 42, null]) {
    const { local, pod, localProfile, key, run } = setup();
    await local.store.save(SUBJECT, bad as never);
    await assert.rejects(run(), TypeError);
    assert.equal(pod.calls.includes("save"), false);
    assert.equal(local.calls.includes("delete"), false);
    assert.ok(localProfile.records.has(key));
  }
});

test("a corrupt destination record stops the move and the source is kept", async () => {
  const { local, pod, run } = setup();
  await seed(local.store, [bobRevoked]);
  await seed(pod.store, [carolDeleted]);
  pod.state.corruptReads = true;
  pod.calls.length = 0;
  await assert.rejects(run(), TypeError);
  assert.ok(await local.inner.load(SUBJECT));
  assert.equal(pod.calls.includes("save"), false);
});

test("only the requested subject's events are touched", async () => {
  const { local, pod, run } = setup();
  await seed(local.store, [bobRevoked]);
  await seed(local.store, [carolDeleted], "user-456");
  await run();
  assert.ok(await local.inner.load("user-456"));
  assert.equal(await pod.inner.load("user-456"), undefined);
});

test("a store of the wrong placement for its side is refused before any call", async () => {
  const { local, pod, localProfile, key } = setup();
  await seed(local.store, [bobRevoked]);
  local.calls.length = 0;
  await assert.rejects(transitionRecommendationProfilePersistence({
    subjectId: SUBJECT, policy: POLICY, now: NOW,
    from: { adapter: localProfile, storageTarget: "local_app", candidateEventStore: pod.store },
    to: { adapter: new ProfileAdapter(POD_PROFILE_MANIFEST), storageTarget: "user_pod", candidateEventStore: local.store }
  }), (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.deny.storage_placement_policy");
  assert.deepEqual([...local.calls, ...pod.calls], []);
  assert.ok(localProfile.records.has(key));
});

test("one store on both sides is rejected instead of waiting on itself", async () => {
  const { local, localProfile, key } = setup();
  await seed(local.store, [bobRevoked]);
  const sharedStore = createInMemoryRecommendationCandidateEventStore({ ...EVENT_LOCAL });
  await assert.rejects(transitionRecommendationProfilePersistence({
    subjectId: SUBJECT, policy: POLICY, now: NOW,
    from: { adapter: localProfile, storageTarget: "local_app", candidateEventStore: sharedStore },
    to: { adapter: new ProfileAdapter(POD_PROFILE_MANIFEST), storageTarget: "user_pod", candidateEventStore: sharedStore }
  }), RecommendationProfilePersistenceError);
  assert.ok(localProfile.records.has(key));
});

test("bad candidate event limits are rejected before any storage call", async () => {
  const { local, pod, run } = setup();
  await seed(local.store, [bobRevoked]);
  local.calls.length = 0;
  await assert.rejects(run({ candidateEventLimits: { retentionMs: 1 } }), TypeError);
  assert.deepEqual([...local.calls, ...pod.calls], []);
});

test("events carry no label, so they move unchanged while the profile is relabelled, and a crash between the two is repaired by rerunning", async () => {
  const { local, pod, localProfile, podProfile, key, run } = setup();
  const seeded = await seed(local.store, [bobRevoked, setDeleted]);
  pod.state.failSaves = 99;
  await assert.rejects(run());
  // The pod profile is already labelled for the pod and the source is untouched, so nothing is mislabelled.
  const inPod = podProfile.records.get(key) as RecommendationProfileStoreRecord;
  assert.deepEqual(inPod.profile.entries[0]!.privacyBoundaries, ["server_allowed"]);
  assert.deepEqual((localProfile.records.get(key) as RecommendationProfileStoreRecord).profile.entries[0]!.privacyBoundaries, ["local_only"]);
  assert.ok(await local.inner.load(SUBJECT));
  assert.equal(await pod.inner.load(SUBJECT), undefined);

  pod.state.failSaves = 0;
  const finished = await run();
  assert.deepEqual([finished.outcome, finished.candidateEvents], ["moved", "moved"]);
  const held = await pod.inner.load(SUBJECT) as RecommendationCandidateEventRecord;
  assert.deepEqual(held.entries.map((entry) => entry.event), seeded.entries.map((entry) => entry.event));
  assert.equal(localProfile.records.has(key), false);
  assert.deepEqual((podProfile.records.get(key) as RecommendationProfileStoreRecord).profile.entries[0]!.privacyBoundaries, ["server_allowed"]);
});
