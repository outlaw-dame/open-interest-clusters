import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationConsentDeniedError,
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

function profile(updatedAt = "2026-10-01T00:00:00.000Z", key = "books.fiction"): RecommendationProfileSnapshot {
  const entry = { target: { kind: "canonical_interest" as const, key }, score: 0.75, confidence: 0.8, signalCount: 1, positiveSignalCount: 1, negativeSignalCount: 0, neutralSignalCount: 0, privacyBoundaries: ["local_only" as const], protocols: ["app_local" as const], sourceVisibilities: ["local_only" as const], updatedAt };
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
  assert.deepEqual((pod.records.get(key) as RecommendationProfileStoreRecord).profile, profile());
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
  const newer = record(SUBJECT, profile("2026-10-01T05:00:00.000Z", "music.jazz"));
  pod.records.set(key, newer);
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(result.outcome, "kept_newer_destination");
  assert.equal(pod.records.get(key), newer);
  assert.equal(pod.log.includes("write"), false);
  assert.equal(local.records.has(key), false);
});

test("an older destination copy is replaced by the source", async () => {
  const { local, pod, key, loc } = setup();
  pod.records.set(key, record(SUBJECT, profile("2026-09-01T00:00:00.000Z", "music.jazz")));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: loc(local, "local_app"), to: loc(pod, "user_pod"), policy: POLICY, now: NOW });
  assert.equal(result.outcome, "moved");
  assert.deepEqual((pod.records.get(key) as RecommendationProfileStoreRecord).profile, profile());
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
