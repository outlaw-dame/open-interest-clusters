import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationCandidateEventConflictError,
  checkRecommendationCandidateEventStoreCompareAndSet,
  createInMemoryRecommendationCandidateEventStore,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationOnboardingLifecycle,
  type RecommendationCandidateEventRecord,
  type RecommendationCandidateEventStore,
  type RecommendationConsentPolicy
} from "../src/index.js";

const SUBJECT = "user-a";
const T1 = "2026-09-26T06:30:00.000Z";
const T2 = "2026-09-26T06:31:00.000Z";
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
const NO_SLEEP = async () => undefined;

type SaveOptions = { expectedDigest: string | null } | undefined;

/** Keeps records in a map. `mode` picks how it treats expectedDigest. */
function fakeStore(mode: "honest" | "ignores" | "rejects_all" | "throws_on_save" | "throws_on_delete", declared = true) {
  const base = createInMemoryRecommendationCandidateEventStore();
  const held = new Map<string, RecommendationCandidateEventRecord>();
  const log: { id: string; expected: SaveOptions }[] = [];
  const store: RecommendationCandidateEventStore = {
    manifest: base.manifest,
    ...(declared ? { supportsCompareAndSet: true } : {}),
    async load(id) { const value = held.get(id); return value === undefined ? undefined : structuredClone(value); },
    async save(id, record, options) {
      log.push({ id, expected: options });
      if (mode === "throws_on_save") throw new Error("disk on fire");
      if (mode === "rejects_all" && options !== undefined) throw new RecommendationCandidateEventConflictError();
      if ((mode === "honest" || mode === "throws_on_delete") && options !== undefined && (held.get(id)?.digest ?? null) !== options.expectedDigest) throw new RecommendationCandidateEventConflictError();
      held.set(id, structuredClone(record));
    },
    async delete(id) { if (mode === "throws_on_delete") throw new Error("nope"); held.delete(id); }
  };
  return { store, held, log };
}

const benign = (name: string) => ({ kind: "account_deleted", occurredAt: T1, candidateId: name }) as const;
const noop = { async invalidate() {} };

function lifecycleFor(store: RecommendationCandidateEventStore) {
  return createRecommendationOnboardingLifecycleWith(store, { retrySleeper: NO_SLEEP });
}

function createRecommendationOnboardingLifecycleWith(store: RecommendationCandidateEventStore, retry: NonNullable<NonNullable<Parameters<typeof createRecommendationOnboardingLifecycle>[0]["candidateEvents"]>["retry"]>) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T1 });
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => T1, invalidators: { embeddings: noop, candidate_cache: noop, explanation_cache: noop } });
  return createRecommendationOnboardingLifecycle({
    derived, engine, now: () => T2,
    candidateEvents: { store, retry }
  });
}

const report = (lifecycle: ReturnType<typeof lifecycleFor>) => lifecycle.reportCandidateEvents({
  subjectId: SUBJECT, policy: POLICY, now: T2,
  events: [benign("c-1")]
});

test("an honest store passes and leaves nothing behind", async () => {
  const { store, held } = fakeStore("honest");
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(store), { status: "passed" });
  assert.equal(held.size, 0);
});

test("the in-memory reference store passes its own check", async () => {
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(createInMemoryRecommendationCandidateEventStore()), { status: "passed" });
});

test("a store that accepts stale writes is reported as failed", async () => {
  const { store, held } = fakeStore("ignores");
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(store), { status: "failed", reason: "accepted_stale_write" });
  assert.equal(held.size, 0, "probe record cleaned up");
});

test("a store that refuses every guarded write is reported as failed", async () => {
  const { store } = fakeStore("rejects_all");
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(store), { status: "failed", reason: "refused_current_write" });
});

test("a store that does not declare support fails without being touched", async () => {
  const { store, log } = fakeStore("honest", false);
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(store), { status: "failed", reason: "not_declared" });
  assert.equal(log.length, 0);
});

test("a throwing store is inconclusive and the error text is not exposed", async () => {
  const result = await checkRecommendationCandidateEventStoreCompareAndSet(fakeStore("throws_on_save").store);
  assert.deepEqual(result, { status: "inconclusive", reason: "store_error" });
  assert.ok(!JSON.stringify(result).includes("disk on fire"));
});

test("a failing probe cleanup does not change the verdict", async () => {
  assert.deepEqual(await checkRecommendationCandidateEventStoreCompareAndSet(fakeStore("throws_on_delete").store), { status: "passed" });
});

test("the probe never touches a real subject id and rejects an invalid one", async () => {
  const { store, log } = fakeStore("honest");
  await checkRecommendationCandidateEventStoreCompareAndSet(store);
  assert.ok(log.length > 0 && log.every((entry) => entry.id.startsWith("cas-conformance-probe-")));
  await assert.rejects(checkRecommendationCandidateEventStoreCompareAndSet(store, { probeSubjectId: " bad" }), TypeError);
});

test("lifecycle sends expectedDigest to a store that passes the check", async () => {
  const { store, log } = fakeStore("honest");
  await report(lifecycleFor(store));
  const real = log.filter((entry) => entry.id === SUBJECT);
  assert.equal(real.length, 1);
  assert.deepEqual(real[0]?.expected, { expectedDigest: null });
});

test("lifecycle falls back to the serialized path for a store that lies, and still saves", async () => {
  const { store, log, held } = fakeStore("ignores");
  await report(lifecycleFor(store));
  const real = log.filter((entry) => entry.id === SUBJECT);
  assert.equal(real.length, 1);
  assert.equal(real[0]?.expected, undefined, "no expectedDigest is passed to a store that ignores it");
  assert.equal(held.get(SUBJECT)?.entries.length, 1);
});

test("lifecycle checks only once after a definite answer", async () => {
  const { store, log } = fakeStore("ignores");
  const lifecycle = lifecycleFor(store);
  await report(lifecycle);
  const probeSaves = () => log.filter((entry) => entry.id !== SUBJECT).length;
  const after = probeSaves();
  await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, policy: POLICY, now: T2, events: [benign("c-2")] });
  assert.equal(probeSaves(), after);
});

function failingProbe(store: RecommendationCandidateEventStore, failures: () => boolean) {
  const realSave = store.save.bind(store);
  store.save = async (id, record, options) => {
    if (id !== SUBJECT && failures()) throw new Error("brief outage");
    await realSave(id, record, options);
  };
}

test("a one-off probe error is retried with backoff and the write still goes out guarded", async () => {
  const { store, log } = fakeStore("honest");
  let probeFailures = 2;
  failingProbe(store, () => probeFailures-- > 0);
  const delays: number[] = [];
  const lifecycle = createRecommendationOnboardingLifecycleWith(store, { retrySleeper: async (ms) => { delays.push(ms); }, random: () => 0, jitterRatio: 0 });
  await report(lifecycle);
  const real = log.filter((entry) => entry.id === SUBJECT);
  assert.equal(real.length, 1);
  assert.deepEqual(real[0]?.expected, { expectedDigest: null }, "never sent without the guard");
  assert.deepEqual(delays, [25, 50], "exponential backoff between probe attempts");
});

test("a store that keeps failing the probe fails the write closed and stores nothing", async () => {
  const { store, log, held } = fakeStore("honest");
  failingProbe(store, () => true);
  const lifecycle = lifecycleFor(store);
  await assert.rejects(report(lifecycle), /could not be verified, so nothing was written/u);
  assert.equal(log.filter((entry) => entry.id === SUBJECT).length, 0, "no unguarded save reached the real subject");
  assert.equal(held.has(SUBJECT), false);
});

test("an inconclusive check is not remembered, so the next write re-checks and is guarded", async () => {
  const { store, log } = fakeStore("honest");
  let down = true;
  failingProbe(store, () => down);
  const lifecycle = lifecycleFor(store);
  await assert.rejects(report(lifecycle));
  down = false;
  await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, policy: POLICY, now: T2, events: [benign("c-2")] });
  const last = log.filter((entry) => entry.id === SUBJECT).at(-1);
  assert.ok(last?.expected !== undefined, "guard is used once the store checks out");
});
