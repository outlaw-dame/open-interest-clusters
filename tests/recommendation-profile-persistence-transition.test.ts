import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationConsentDeniedError,
  readRecommendationProfileStoreRecordSafely,
  writeRecommendationProfileStoreRecordSafely,
  RecommendationProfilePersistenceError,
  RecommendationProfilePersistenceTransitionError,
  createRecommendationProfileStoreRecord,
  createRecommendationProfileSubjectKey,
  transitionRecommendationProfilePersistence,
  type RecommendationConsentPolicy,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfilePersistenceLocation,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const SUBJECT = "user-123";
const NOW = "2026-10-02T00:00:00.000Z";
const LOCAL: RecommendationStateStorageAdapterManifest = { adapterId: "local", domains: ["interest_profile"], authority: "device_owned", processingBoundary: "local_only", persistence: "persistent", requiresNetwork: false, supportsOffline: true, userExportable: true, userDeletable: true, encryptedAtRest: false };
const POD: RecommendationStateStorageAdapterManifest = { ...LOCAL, adapterId: "pod", authority: "user_owned", processingBoundary: "server_allowed", requiresNetwork: true, supportsOffline: false };
const PROVIDER: RecommendationStateStorageAdapterManifest = { ...POD, adapterId: "provider", authority: "provider_owned" };
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"], serverSideDataUses: ["local_personalization"] };

function profile(updatedAt = "2026-10-01T00:00:00.000Z", key = "books.fiction", boundary: "local_only" | "server_allowed" = "local_only"): RecommendationProfileSnapshot {
  const entry = { target: { kind: "canonical_interest" as const, key }, score: 0.75, confidence: 0.8, signalCount: 1, positiveSignalCount: 1, negativeSignalCount: 0, neutralSignalCount: 0, privacyBoundaries: [boundary], protocols: ["app_local" as const], sourceVisibilities: ["local_only" as const], updatedAt };
  return { schemaVersion: "recommendation-profile.v1", updatedAt, signalCount: 1, entries: [entry] };
}
function record(subjectId = SUBJECT, snapshot = profile()): RecommendationProfileStoreRecord {
  return createRecommendationProfileStoreRecord({ subjectId, profile: snapshot, writtenAt: "2026-10-01T00:00:01.000Z" });
}

class MemoryAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  readonly log: string[] = [];
  failWrites = 0;
  failDeletes = 0;
  dropWrites = false;
  constructor(readonly storageManifest: RecommendationStateStorageAdapterManifest, private readonly name: string, private readonly shared?: string[]) {}
  private note(entry: string): void { this.log.push(entry); this.shared?.push(`${this.name}:${entry}`); }
  async readProfileRecord(subjectKey: string): Promise<unknown | null> { this.note("read"); return this.records.get(subjectKey) ?? null; }
  async writeProfileRecord(value: RecommendationProfileStoreRecord): Promise<void> {
    this.note("write");
    if (this.failWrites > 0) { this.failWrites -= 1; throw new Error("write failed"); }
    if (!this.dropWrites) this.records.set(value.subjectKey, value);
  }
  async deleteProfileRecord(subjectKey: string): Promise<void> {
    this.note("delete");
    if (this.failDeletes > 0) { this.failDeletes -= 1; throw new Error("delete failed"); }
    this.records.delete(subjectKey);
  }
}

function setup(seed: "local" | "pod" | "none" = "local") {
  const order: string[] = [];
  const local = new MemoryAdapter(LOCAL, "local", order);
  const pod = new MemoryAdapter(POD, "pod", order);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  if (seed === "local") local.records.set(key, record());
  if (seed === "pod") pod.records.set(key, record());
  const loc = (adapter: MemoryAdapter, storageTarget: "local_app" | "user_pod"): RecommendationProfilePersistenceLocation => ({ adapter, storageTarget });
  const retry = (sleeps: number[]) => ({ sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5 });
  return { order, local, pod, key, loc, retry };
}

test("local to user-owned storage copies, verifies by reading back, then deletes the source", async () => {
  const { local, pod, key, loc, order } = setup();
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.deepEqual(result, { outcome: "moved", from: "local_app", to: "user_pod" });
  assert.equal(local.records.has(key), false);
  assert.deepEqual((pod.records.get(key) as RecommendationProfileStoreRecord).profile, profile(undefined, undefined, "server_allowed"));
  assert.equal((pod.records.get(key) as RecommendationProfileStoreRecord).writtenAt, "2026-10-01T00:00:01.000Z");
  const writeAt = order.indexOf("pod:write");
  assert.ok(writeAt >= 0 && order.indexOf("pod:read", writeAt) > writeAt, "write is read back");
  assert.ok(order.indexOf("local:delete") > order.lastIndexOf("pod:read"), "source is deleted last");
});

test("user-owned storage back to the device needs no server consent", async () => {
  const { local, pod, key, loc } = setup("pod");
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW });
  assert.equal(result.outcome, "moved");
  assert.ok(local.records.has(key));
  assert.equal(pod.records.has(key), false);
});

test("moving to a remote store without consent, or with consent for someone else or revoked, leaves the source untouched", async () => {
  for (const policy of [null, undefined, { ...POLICY, subjectId: "someone-else" }, { ...POLICY, revokedAt: "2026-10-01T12:00:00.000Z" }, { ...POLICY, serverSideDataUses: [] }] as const) {
    const { local, pod, key, loc } = setup();
    await assert.rejects(
      transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy, now: NOW, retry: { sleep: async () => undefined } }),
      (error: unknown) => error instanceof RecommendationProfilePersistenceError || error instanceof RecommendationConsentDeniedError
    );
    assert.ok(local.records.has(key));
    assert.equal(pod.records.size, 0);
    assert.equal(local.log.includes("delete"), false);
  }
});

test("provider-hosted, server-profile and operator placements are refused", async () => {
  const { local, loc, key } = setup();
  const provider = new MemoryAdapter(PROVIDER, "provider");
  for (const target of ["provider_hosted", "server_profile", "ephemeral_session", "nonsense"]) {
    await assert.rejects(
      transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: { adapter: provider, storageTarget: target as never }, policy: POLICY }),
      (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.deny.unsupported_target"
    );
  }
  // A provider-owned adapter is rejected outright, and an adapter cannot claim the other side's placement.
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(provider, "user_pod"), policy: POLICY, now: NOW }),
    /violates placement policy/u
  );
  const pod = new MemoryAdapter(POD, "pod");
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "user_pod"), to: loc(pod, "local_app"), policy: POLICY, now: NOW }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.deny.storage_placement_policy"
  );
  assert.equal(pod.log.length, 0);
  assert.ok(local.records.has(key));
  assert.equal(provider.records.size, 0);
});

test("the same location, or one adapter and key on both sides, is rejected so nothing deletes its own copy", async () => {
  const { local, pod, loc, key } = setup();
  await assert.rejects(transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "local_app"), policy: POLICY }), (e: unknown) => e instanceof RecommendationProfilePersistenceTransitionError && e.reason === "transition.deny.same_location");
  const shared = new MemoryAdapter(POD, "shared");
  shared.records.set(key, record());
  await assert.rejects(transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(shared, "local_app"), to: loc(shared, "user_pod"), policy: POLICY }), (e: unknown) => e instanceof RecommendationProfilePersistenceTransitionError && e.reason === "transition.deny.same_location");
  assert.ok(shared.records.has(key));
  assert.equal(shared.log.length, 0);
});

test("a flaky destination is retried with exponential, jittered backoff and then succeeds", async () => {
  const { local, pod, key, loc, retry } = setup();
  pod.failWrites = 2;
  const sleeps: number[] = [];
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...retry(sleeps), baseDelayMs: 100 } });
  assert.equal(result.outcome, "moved");
  assert.deepEqual(sleeps, [50, 100]);
  assert.ok(pod.records.has(key));
  assert.equal(local.records.has(key), false);
});

test("a destination that keeps failing leaves the source intact and stops after the attempt limit", async () => {
  const { local, pod, key, loc, retry } = setup();
  pod.failWrites = 99;
  const sleeps: number[] = [];
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...retry(sleeps), baseDelayMs: 100, maxAttempts: 4 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.error.adapter_write_failed"
  );
  assert.equal(pod.log.filter((entry) => entry === "write").length, 4);
  assert.deepEqual(sleeps, [50, 100, 200]);
  assert.ok(local.records.has(key));
  assert.equal(local.log.includes("delete"), false);
});

test("an abort during a backoff sleep ends the transition without waiting or another attempt", async () => {
  const { local, pod, key, loc } = setup();
  pod.failWrites = 99;
  const controller = new AbortController();
  let sleepStarted = false;
  // This sleep never finishes on its own, so only the abort signal can end the wait.
  const sleep = () => new Promise<void>(() => { sleepStarted = true; setTimeout(() => controller.abort(new Error("stop")), 0); });
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, signal: controller.signal, retry: { sleep, random: () => 0.5, maxAttempts: 4 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.aborted"
  );
  assert.equal(sleepStarted, true);
  assert.equal(pod.log.filter((entry) => entry === "write").length, 1);
  assert.ok(local.records.has(key));
  assert.equal(local.log.includes("delete"), false);
});

test("the default backoff timer is cleared when an abort ends the wait", async () => {
  const { local, pod, loc } = setup();
  pod.failWrites = 99;
  const controller = new AbortController();
  const countTimers = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
  const before = countTimers();
  setTimeout(() => controller.abort(new Error("stop")), 5);
  const started = Date.now();
  // A multi-second delay, so a leaked timer would still be pending after the abort.
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, signal: controller.signal, retry: { random: () => 0.99, baseDelayMs: 5_000, maxAttempts: 4 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.aborted"
  );
  assert.ok(Date.now() - started < 2_000);
  assert.equal(countTimers(), before);
});

test("denials are final and never retried", async () => {
  const { local, pod, loc, retry } = setup();
  const sleeps: number[] = [];
  await assert.rejects(transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: null, now: NOW, retry: retry(sleeps) }));
  assert.deepEqual(sleeps, []);
  assert.equal(pod.log.filter((entry) => entry === "write").length, 0);
});

test("a destination that silently drops the write fails verification and the source survives", async () => {
  const { local, pod, key, loc, retry } = setup();
  pod.dropWrites = true;
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...retry([]), maxAttempts: 2 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.error.write_verification_failed"
  );
  assert.ok(local.records.has(key));
});

test("a source that cannot be deleted is reported as pending, and rerunning finishes it without a second copy", async () => {
  const { local, pod, key, loc, retry } = setup();
  local.failDeletes = 99;
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...retry([]), maxAttempts: 2 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_cleanup_pending" && error.cause instanceof RecommendationProfilePersistenceError
  );
  assert.ok(pod.records.has(key) && local.records.has(key));
  local.failDeletes = 0;
  const finished = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(finished.outcome, "moved");
  assert.equal(local.records.has(key), false);
  assert.ok(pod.records.has(key));
  const again = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(again.outcome, "already_moved");
});

test("a destination that already holds a newer profile is kept, and only the stale source is removed", async () => {
  const { local, pod, key, loc } = setup();
  const newer = record(SUBJECT, profile("2026-10-01T05:00:00.000Z", "music.jazz", "server_allowed"));
  pod.records.set(key, newer);
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(result.outcome, "kept_newer_destination");
  assert.equal(pod.records.get(key), newer);
  assert.equal(pod.log.includes("write"), false);
  assert.equal(local.records.has(key), false);
});

test("an older destination copy is replaced by the source", async () => {
  const { local, pod, key, loc } = setup();
  pod.records.set(key, record(SUBJECT, profile("2026-09-01T00:00:00.000Z", "music.jazz", "server_allowed")));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(result.outcome, "moved");
  assert.deepEqual((pod.records.get(key) as RecommendationProfileStoreRecord).profile, profile(undefined, undefined, "server_allowed"));
});

test("nothing to move is an error, not a silent success", async () => {
  const { local, pod, loc } = setup("none");
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_missing"
  );
});

test("only the requested subject's record is read, written or deleted", async () => {
  const { local, pod, key, loc } = setup();
  const otherKey = createRecommendationProfileSubjectKey({ subjectId: "user-456" });
  local.records.set(otherKey, record("user-456"));
  await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.ok(local.records.has(otherKey));
  assert.equal(pod.records.has(otherKey), false);
  assert.ok(pod.records.has(key));
});

test("namespace and salt choose the keys on each side independently", async () => {
  const { local, pod } = setup("none");
  const fromKey = createRecommendationProfileSubjectKey({ subjectId: SUBJECT, namespace: "old", salt: "s1" });
  const toKey = createRecommendationProfileSubjectKey({ subjectId: SUBJECT, namespace: "new", salt: "s2" });
  local.records.set(fromKey, record());
  await transitionRecommendationProfilePersistence({
    subjectId: SUBJECT,
    from: { adapter: local, storageTarget: "local_app", namespace: "old", salt: "s1" },
    to: { adapter: pod, storageTarget: "user_pod", namespace: "new", salt: "s2" },
    policy: POLICY, now: NOW
  });
  assert.equal(local.records.size, 0);
  assert.equal((pod.records.get(toKey) as RecommendationProfileStoreRecord).subjectKey, toKey);
});

test("an aborted transition stops before touching storage", async () => {
  const { local, pod, key, loc } = setup();
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, signal: controller.signal }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.aborted"
  );
  assert.ok(local.records.has(key));
  assert.equal(pod.log.length, 0);
});

test("concurrent transitions for one subject are serialized, so the second finds the work done", async () => {
  const { local, pod, loc } = setup();
  const run = () => transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(first.outcome, "moved");
  assert.equal(second.outcome, "already_moved");
  assert.equal(pod.log.filter((entry) => entry === "write").length, 1);
});

test("bad input and retry options are rejected before any storage call", async () => {
  const { local, pod, loc } = setup();
  const base = { subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY };
  await assert.rejects(transitionRecommendationProfilePersistence(null as never), TypeError);
  await assert.rejects(transitionRecommendationProfilePersistence({ ...base, subjectId: " " }), TypeError);
  await assert.rejects(transitionRecommendationProfilePersistence({ ...base, from: null as never }), TypeError);
  await assert.rejects(transitionRecommendationProfilePersistence({ ...base, now: "later" }), TypeError);
  for (const retry of [{ maxAttempts: 0 }, { maxAttempts: 7 }, { baseDelayMs: 0 }, { baseDelayMs: 5001 }, { maxAttempts: 1.5 }]) {
    await assert.rejects(transitionRecommendationProfilePersistence({ ...base, retry }), TypeError, JSON.stringify(retry));
  }
  assert.equal(local.log.length + pod.log.length, 0);
});

test("a far-future time is rejected before anything is read or written", async () => {
  const { local, pod, key, loc } = setup();
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: "2099-01-01T00:00:00.000Z" }),
    RangeError
  );
  assert.equal(local.records.has(key), true);
  assert.equal(pod.records.has(key), false);
  assert.deepEqual([...local.log, ...pod.log], []);
});

test("a time just inside the skew window still moves the profile", async () => {
  const { local, pod, key, loc } = setup();
  const now = new Date(Date.now() + 60_000).toISOString();
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now });
  assert.equal(result.outcome, "moved");
  assert.equal(local.records.has(key), false);
});

// What the interests are labelled depends on where they are processed: local_only on the device,
// server_allowed in the user's pod. These tests cover every way the label can end up wrong after a crash.

function boundariesIn(adapter: MemoryAdapter, key: string): string[] {
  const stored = adapter.records.get(key) as RecommendationProfileStoreRecord;
  return [...new Set(stored.profile.entries.flatMap((entry) => entry.privacyBoundaries))];
}
function mixedProfile(): RecommendationProfileSnapshot {
  const base = profile();
  return { ...base, entries: [{ ...base.entries[0]!, privacyBoundaries: ["local_only", "server_allowed"] }] };
}

test("moving to the pod relabels the interests server_allowed and moving back relabels them local_only", async () => {
  const { local, pod, key, loc, retry } = setup();
  const original = (local.records.get(key) as RecommendationProfileStoreRecord).profile;
  const up = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: retry([]) });
  assert.equal(up.outcome, "moved");
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  assert.equal(local.records.has(key), false);

  const down = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW, retry: retry([]) });
  assert.equal(down.outcome, "moved");
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
  assert.deepEqual((local.records.get(key) as RecommendationProfileStoreRecord).profile, original, "only the label changed, so the round trip returns the same profile");
  assert.equal(pod.records.has(key), false);
});

test("an entry carrying both labels ends up with exactly the label of its new home", async () => {
  const { local, pod, key, loc } = setup("none");
  local.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: mixedProfile(), writtenAt: "2026-10-01T00:00:01.000Z" }));
  await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW });
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
});

test("the pod is never written, and nothing is relabelled, without server-side consent", async () => {
  for (const policy of [null, undefined, { ...POLICY, serverSideDataUses: [] }, { ...POLICY, revokedAt: "2026-10-01T12:00:00.000Z" }, { ...POLICY, deleteDerivedDataRequestedAt: "2026-10-01T12:00:00.000Z" }, { ...POLICY, subjectId: "someone-else" }] as const) {
    const { local, pod, key, loc, retry } = setup();
    const before = local.records.get(key);
    await assert.rejects(transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy, now: NOW, retry: retry([]) }));
    assert.equal(pod.log.includes("write"), false);
    assert.equal(local.records.get(key), before);
    assert.deepEqual(boundariesIn(local, key), ["local_only"]);
  }
});

test("a boundary choice that does not fit the destination is refused and the source stays as it was", async () => {
  const up = setup();
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: up.loc(up.local, "local_app"), to: up.loc(up.pod, "user_pod"), policy: POLICY, now: NOW, privacyBoundary: "local_only", retry: up.retry([]) }),
    /user_pod.*server_allowed/u
  );
  assert.equal(up.pod.records.size, 0);
  assert.deepEqual(boundariesIn(up.local, up.key), ["local_only"]);
  const down = setup("none");
  down.pod.records.set(down.key, record(SUBJECT, profile(undefined, undefined, "server_allowed")));
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: down.loc(down.pod, "user_pod"), to: down.loc(down.local, "local_app"), policy: null, now: NOW, privacyBoundary: "server_allowed", retry: down.retry([]) }),
    /local_app.*local_only/u
  );
  assert.equal(down.local.records.size, 0);
  assert.deepEqual(boundariesIn(down.pod, down.key), ["server_allowed"]);
});

test("a crash after the copy leaves each store with its own label, and rerunning finishes without another write", async () => {
  const { local, pod, key, loc, retry } = setup();
  local.failDeletes = 99;
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...retry([]), maxAttempts: 2 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_cleanup_pending"
  );
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
  local.failDeletes = 0;
  const writesBefore = pod.log.filter((entry) => entry === "write").length;
  const finished = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: retry([]) });
  assert.equal(finished.outcome, "moved");
  assert.equal(local.records.has(key), false);
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  assert.equal(pod.log.filter((entry) => entry === "write").length, writesBefore + 1, "the copy is simply written again with the same content");
  const again = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: retry([]) });
  assert.equal(again.outcome, "already_moved");
  assert.equal(pod.log.filter((entry) => entry === "write").length, writesBefore + 1, "an already healthy destination is not rewritten");
});

test("the same crash on the way back leaves the pod copy labelled for the pod and the device copy for the device", async () => {
  const { local, pod, key, loc, retry } = setup("none");
  pod.records.set(key, record(SUBJECT, profile(undefined, undefined, "server_allowed")));
  pod.failDeletes = 99;
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW, retry: { ...retry([]), maxAttempts: 2 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceTransitionError && error.reason === "transition.error.source_cleanup_pending"
  );
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  pod.failDeletes = 0;
  assert.equal((await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW, retry: retry([]) })).outcome, "moved");
  assert.equal(pod.records.has(key), false);
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
});

test("a flaky write while relabelling is retried, and a dropped write never leaves a half-labelled destination", async () => {
  const flaky = setup();
  flaky.pod.failWrites = 2;
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: flaky.loc(flaky.local, "local_app"), to: flaky.loc(flaky.pod, "user_pod"), policy: POLICY, now: NOW, retry: flaky.retry([]) });
  assert.equal(result.outcome, "moved");
  assert.deepEqual(boundariesIn(flaky.pod, flaky.key), ["server_allowed"]);

  const dropped = setup();
  dropped.pod.dropWrites = true;
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: dropped.loc(dropped.local, "local_app"), to: dropped.loc(dropped.pod, "user_pod"), policy: POLICY, now: NOW, retry: { ...dropped.retry([]), maxAttempts: 2 } }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.error.write_verification_failed"
  );
  assert.equal(dropped.pod.records.size, 0);
  assert.deepEqual(boundariesIn(dropped.local, dropped.key), ["local_only"]);
});

test("a pod record that an older release stored as local_only still loads, and the next write heals it", async () => {
  const { pod, key } = setup("none");
  const legacy = record(SUBJECT, profile());
  pod.records.set(key, legacy);
  const read = await readRecommendationProfileStoreRecordSafely(pod, { subjectId: SUBJECT, storageTarget: "user_pod" });
  assert.ok(read);
  assert.deepEqual(read.profile.entries[0]!.privacyBoundaries, ["local_only"], "accepted as it is stored");

  const written = await writeRecommendationProfileStoreRecordSafely(pod, { subjectId: SUBJECT, profile: read.profile, writtenAt: read.writtenAt, storageTarget: "user_pod", policy: POLICY, verifyWrite: true });
  assert.deepEqual(written.record.profile.entries[0]!.privacyBoundaries, ["server_allowed"]);
  assert.equal(written.verified, true);
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  const healed = await readRecommendationProfileStoreRecordSafely(pod, { subjectId: SUBJECT, storageTarget: "user_pod" });
  assert.deepEqual(healed?.profile.entries[0]!.privacyBoundaries, ["server_allowed"]);
});

test("a write to the pod without server-side consent leaves a legacy local_only record untouched", async () => {
  const { pod, key } = setup("none");
  pod.records.set(key, record(SUBJECT, profile()));
  await assert.rejects(
    writeRecommendationProfileStoreRecordSafely(pod, { subjectId: SUBJECT, profile: profile(), writtenAt: NOW, storageTarget: "user_pod", policy: { ...POLICY, serverSideDataUses: [] } }),
    RecommendationConsentDeniedError
  );
  assert.deepEqual(boundariesIn(pod, key), ["local_only"]);
  assert.equal(pod.log.includes("write"), false);
});

test("a write refuses a privacy boundary that does not fit the storage target, in both directions", async () => {
  const { local, pod } = setup("none");
  await assert.rejects(writeRecommendationProfileStoreRecordSafely(pod, { subjectId: SUBJECT, profile: profile(), writtenAt: NOW, storageTarget: "user_pod", policy: POLICY, privacyBoundary: "local_only" }), /user_pod.*server_allowed/u);
  await assert.rejects(writeRecommendationProfileStoreRecordSafely(local, { subjectId: SUBJECT, profile: profile(), writtenAt: NOW, storageTarget: "local_app", policy: POLICY, privacyBoundary: "server_allowed" }), /local_app.*local_only/u);
  assert.equal(pod.records.size + local.records.size, 0);
  assert.equal(pod.log.length + local.log.length, 0);
});

test("a legacy pod copy is healed when the transition keeps it because it is newer than the source", async () => {
  const { local, pod, key, loc, retry } = setup();
  pod.records.set(key, record(SUBJECT, profile("2026-10-01T05:00:00.000Z", "music.jazz")));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: retry([]) });
  assert.equal(result.outcome, "kept_newer_destination");
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
  assert.equal((pod.records.get(key) as RecommendationProfileStoreRecord).profile.entries[0]!.target.key, "music.jazz", "the newer content is kept, only the label changed");
  assert.equal(local.records.has(key), false);
});

test("a legacy pod copy is healed when the transition finds the source already gone, and healing needs consent", async () => {
  const { local, pod, key, loc, retry } = setup("none");
  pod.records.set(key, record(SUBJECT, profile()));
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: null, now: NOW, retry: retry([]) }),
    (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.deny.server_consent_required"
  );
  assert.deepEqual(boundariesIn(pod, key), ["local_only"], "no consent, no change");
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW, retry: retry([]) });
  assert.equal(result.outcome, "already_moved");
  assert.deepEqual(boundariesIn(pod, key), ["server_allowed"]);
});

test("a device copy left with the pod's label by an interrupted move back is healed on rerun", async () => {
  const { local, pod, key, loc, retry } = setup("none");
  local.records.set(key, record(SUBJECT, profile(undefined, undefined, "server_allowed")));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(pod, "user_pod"), to: loc(local, "local_app"), policy: null, now: NOW, retry: retry([]) });
  assert.equal(result.outcome, "already_moved");
  assert.deepEqual(boundariesIn(local, key), ["local_only"]);
});
