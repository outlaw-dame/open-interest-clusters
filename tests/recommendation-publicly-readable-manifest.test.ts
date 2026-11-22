import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_STATE_DOMAINS,
  RecommendationProfilePersistenceError,
  assertRecommendationCandidateEventStore,
  assertRecommendationStateStorageManifest,
  createInMemoryRecommendationCandidateEventStore,
  createRecommendationProfileStoreRecord,
  createRecommendationProfileSubjectKey,
  evaluateRecommendationStatePlacement,
  evaluateRecommendationStateStorageManifest,
  getRecommendationStateDomainMetadata,
  readRecommendationProfileStoreRecordSafely,
  transitionRecommendationProfilePersistence,
  writeRecommendationProfileStoreRecordSafely,
  type RecommendationConsentPolicy,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

const SUBJECT = "subject-publicly-readable";
const NOW = new Date().toISOString();
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"], serverSideDataUses: ["local_personalization"] };
const RETRY = { sleep: async () => undefined };

const LOCAL: RecommendationStateStorageAdapterManifest = { adapterId: "local", domains: ["interest_profile"], authority: "device_owned", processingBoundary: "local_only", persistence: "persistent", requiresNetwork: false, supportsOffline: true, userExportable: true, userDeletable: true, encryptedAtRest: false };
const POD: RecommendationStateStorageAdapterManifest = { ...LOCAL, adapterId: "pod", authority: "user_owned", processingBoundary: "server_allowed", requiresNetwork: true, supportsOffline: false };
const withPublic = (base: RecommendationStateStorageAdapterManifest, publiclyReadable: unknown): RecommendationStateStorageAdapterManifest =>
  ({ ...base, publiclyReadable }) as RecommendationStateStorageAdapterManifest;
const eventsOf = (m: RecommendationStateStorageAdapterManifest): RecommendationStateStorageAdapterManifest => ({ ...m, domains: ["candidate_lifecycle_events"] });

function snapshot(label: "local_only" | "server_allowed"): RecommendationProfileSnapshot {
  const entry = { target: { kind: "canonical_interest" as const, key: "books.fiction" }, score: 0.75, confidence: 0.8, signalCount: 1, positiveSignalCount: 1, negativeSignalCount: 0, neutralSignalCount: 0, privacyBoundaries: [label], protocols: ["app_local" as const], sourceVisibilities: ["local_only" as const], updatedAt: "2026-10-01T00:00:00.000Z" };
  return { schemaVersion: "recommendation-profile.v1", updatedAt: "2026-10-01T00:00:00.000Z", signalCount: 1, entries: [entry] };
}

class MemoryAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  calls = 0;
  constructor(readonly storageManifest: RecommendationStateStorageAdapterManifest) {}
  async readProfileRecord(subjectKey: string): Promise<unknown | null> { this.calls += 1; return this.records.get(subjectKey) ?? null; }
  async writeProfileRecord(value: RecommendationProfileStoreRecord): Promise<void> { this.calls += 1; this.records.set(value.subjectKey, value); }
  async deleteProfileRecord(subjectKey: string): Promise<void> { this.calls += 1; this.records.delete(subjectKey); }
}

const isPlacementDenial = (error: unknown): boolean =>
  error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.deny.storage_placement_policy";

test("publiclyReadable true is refused for every subject-level domain, and absent or false changes nothing", () => {
  const subjectLevel = RECOMMENDATION_STATE_DOMAINS.filter((domain) => getRecommendationStateDomainMetadata(domain).subjectLevel);
  assert.ok(subjectLevel.length >= 10);
  for (const domain of subjectLevel) {
    const base = { ...POD, domains: [domain] };
    const absent = evaluateRecommendationStatePlacement(base, domain);
    assert.equal(absent.decision, "allow", domain);
    assert.deepEqual(evaluateRecommendationStatePlacement(withPublic(base, false), domain), absent, domain);
    const denied = evaluateRecommendationStatePlacement(withPublic(base, true), domain);
    assert.equal(denied.decision, "deny", domain);
    assert.equal(denied.reason, "state.deny.publicly_readable_store", domain);
    assert.throws(() => assertRecommendationStateStorageManifest(withPublic(base, true)), TypeError, domain);
  }
  assert.equal(evaluateRecommendationStateStorageManifest(withPublic(POD, true)).decision, "deny");
});

test("a publiclyReadable value that is not a boolean fails closed", () => {
  for (const value of [null, "true", "false", 0, 1, {}, []]) {
    assert.throws(() => assertRecommendationStateStorageManifest(withPublic(POD, value)), TypeError, String(value));
    assert.throws(() => evaluateRecommendationStatePlacement(withPublic(POD, value), "interest_profile"), TypeError, String(value));
  }
  // An explicit undefined is the same as leaving the field out.
  assert.doesNotThrow(() => assertRecommendationStateStorageManifest(withPublic(POD, undefined)));
  assert.equal("publiclyReadable" in assertRecommendationStateStorageManifest(POD), false);
  assert.equal(assertRecommendationStateStorageManifest(withPublic(POD, false)).publiclyReadable, false);
});

test("profile store: a publicly readable adapter is refused for write and read before it is called", async () => {
  const adapter = new MemoryAdapter(withPublic(POD, true));
  await assert.rejects(
    writeRecommendationProfileStoreRecordSafely(adapter, { subjectId: SUBJECT, profile: snapshot("server_allowed"), writtenAt: NOW, storageTarget: "user_pod", policy: POLICY }),
    TypeError
  );
  await assert.rejects(readRecommendationProfileStoreRecordSafely(adapter, { subjectId: SUBJECT, storageTarget: "user_pod" }), TypeError);
  assert.equal(adapter.calls, 0);

  const declaredFalse = new MemoryAdapter(withPublic(POD, false));
  await writeRecommendationProfileStoreRecordSafely(declaredFalse, { subjectId: SUBJECT, profile: snapshot("server_allowed"), writtenAt: NOW, storageTarget: "user_pod", policy: POLICY });
  assert.equal(declaredFalse.records.size, 1);
  const absent = new MemoryAdapter(POD);
  await writeRecommendationProfileStoreRecordSafely(absent, { subjectId: SUBJECT, profile: snapshot("server_allowed"), writtenAt: NOW, storageTarget: "user_pod", policy: POLICY });
  assert.equal(absent.records.size, 1);
});

test("candidate event store: a publicly readable store is refused, false and absent are accepted", () => {
  assert.throws(() => assertRecommendationCandidateEventStore(createInMemoryRecommendationCandidateEventStore(withPublic(eventsOf(POD), true))), TypeError);
  assert.throws(() => assertRecommendationCandidateEventStore(createInMemoryRecommendationCandidateEventStore(withPublic(eventsOf(POD), "yes"))), TypeError);
  assert.doesNotThrow(() => assertRecommendationCandidateEventStore(createInMemoryRecommendationCandidateEventStore(withPublic(eventsOf(POD), false))));
  assert.doesNotThrow(() => assertRecommendationCandidateEventStore(createInMemoryRecommendationCandidateEventStore(eventsOf(POD))));
});

test("profile move: a publicly readable destination or source adapter is refused and nothing moves", async () => {
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  const record = createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot("local_only"), writtenAt: "2026-10-01T00:00:01.000Z" });

  const source = new MemoryAdapter(LOCAL);
  source.records.set(key, record);
  const publicDestination = new MemoryAdapter(withPublic(POD, true));
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: { adapter: source, storageTarget: "local_app" }, to: { adapter: publicDestination, storageTarget: "user_pod" }, policy: POLICY, now: NOW, retry: RETRY }),
    TypeError
  );
  assert.equal(publicDestination.records.size, 0);
  assert.equal(publicDestination.calls, 0);
  assert.equal(source.records.has(key), true);

  const publicSource = new MemoryAdapter(withPublic(POD, true));
  publicSource.records.set(key, { ...record });
  const device = new MemoryAdapter(LOCAL);
  await assert.rejects(
    transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: { adapter: publicSource, storageTarget: "user_pod" }, to: { adapter: device, storageTarget: "local_app" }, policy: null, now: NOW, retry: RETRY }),
    TypeError
  );
  assert.equal(device.records.size, 0);
  assert.equal(publicSource.records.has(key), true);
});

test("profile move: a publicly readable candidate event store is refused on either side", async () => {
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  const record = createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot("local_only"), writtenAt: "2026-10-01T00:00:01.000Z" });
  const cases = [
    { from: createInMemoryRecommendationCandidateEventStore(eventsOf(LOCAL)), to: createInMemoryRecommendationCandidateEventStore(withPublic(eventsOf(POD), true)) },
    { from: createInMemoryRecommendationCandidateEventStore(withPublic(eventsOf(LOCAL), true)), to: createInMemoryRecommendationCandidateEventStore(eventsOf(POD)) }
  ];
  for (const [index, { from, to }] of cases.entries()) {
    const source = new MemoryAdapter(LOCAL);
    source.records.set(key, record);
    const destination = new MemoryAdapter(POD);
    await assert.rejects(
      transitionRecommendationProfilePersistence({
        subjectId: SUBJECT,
        from: { adapter: source, storageTarget: "local_app", candidateEventStore: from },
        to: { adapter: destination, storageTarget: "user_pod", candidateEventStore: to },
        policy: POLICY, now: NOW, retry: RETRY
      }),
      (error: unknown) => isPlacementDenial(error) || error instanceof TypeError,
      `case ${index}`
    );
    assert.equal(destination.records.size, 0, `case ${index}`);
    assert.equal(source.records.has(key), true, `case ${index}`);
  }
});

test("a move with publiclyReadable false on both stores still works", async () => {
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  const source = new MemoryAdapter(withPublic(LOCAL, false));
  source.records.set(key, createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot("local_only"), writtenAt: "2026-10-01T00:00:01.000Z" }));
  const destination = new MemoryAdapter(withPublic(POD, false));
  const result = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: { adapter: source, storageTarget: "local_app" }, to: { adapter: destination, storageTarget: "user_pod" }, policy: POLICY, now: NOW, retry: RETRY });
  assert.equal(result.outcome, "moved");
  assert.equal(destination.records.size, 1);
});
