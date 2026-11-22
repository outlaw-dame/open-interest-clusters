import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationCandidateEventConflictError,
  RecommendationConsentDeniedError,
  createInMemoryRecommendationCandidateEventStore,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateEventDeletionInvalidator,
  createRecommendationCandidateId,
  createRecommendationCuratedAccountSetSourceId,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationOnboardingLifecycle,
  type RecommendationCandidate,
  type RecommendationCandidateEventStore,
  type RecommendationConsentPolicy,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";
import { MEMBER_SET, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

const A = "user-a";
const B = "user-b";
const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
const T1 = "2026-09-26T06:30:00.000Z";
const T2 = "2026-09-26T06:31:00.000Z";
const T3 = "2026-09-26T06:32:00.000Z";
const NOW = "2026-09-26T06:45:00.000Z";
const SET_SOURCE_ID = createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId);
const POLICY = (subjectId: string): RecommendationConsentPolicy => ({ subjectId, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] });
const NO_SLEEP = async () => undefined;

function candidate(kind: "account" | "starter_pack", name = "1"): RecommendationCandidate {
  const nativeId = `https://example.test/${kind === "account" ? "users" : kind}/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol: "activitypub", nativeId, provider: "example.test" }),
    kind, protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available", observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "test-source", observedAt: OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}
function packPlan() {
  const value = candidate("starter_pack");
  return createRecommendationCandidateActionPlan({
    candidate: value,
    eligibility: { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: "2026-09-26T06:01:00.000Z" },
    provider: actionProvider("starter_pack"),
    createdAt: CREATED_AT,
    starterPackMembers: ["alice", "bob"].map((name) => starterPackMember(candidate("account", name), `acct-${name}`))
  });
}
const bobRevoked = { kind: "member_consent_revoked", occurredAt: T1, candidateId: candidate("account", "bob").candidateId, setSourceId: SET_SOURCE_ID } as const;

/** A store that exposes its raw records so tests can damage them, and counts its calls. */
function rawStore(manifest?: Partial<RecommendationStateStorageAdapterManifest>, options: { cas?: boolean } = {}) {
  const inner = createInMemoryRecommendationCandidateEventStore();
  const raw = new Map<string, unknown>();
  const counts = { save: 0, load: 0, delete: 0 };
  const fail = { save: 0, load: 0, delete: 0 };
  const hooks: { afterLoad?: { onLoad: number; run: () => Promise<void> } } = {};
  const store: RecommendationCandidateEventStore = {
    manifest: { ...inner.manifest, ...manifest },
    ...(options.cas === true ? { supportsCompareAndSet: true } : {}),
    async load(id) {
      counts.load += 1;
      if (fail.load > 0) { fail.load -= 1; throw new Error("load down"); }
      const value = raw.has(id) ? structuredClone(raw.get(id)) : undefined;
      if (hooks.afterLoad?.onLoad === counts.load) { const { run } = hooks.afterLoad; delete hooks.afterLoad; await run(); }
      return value;
    },
    async save(id, record, saveOptions) {
      counts.save += 1;
      if (fail.save > 0) { fail.save -= 1; throw new Error("save down"); }
      if (options.cas === true && saveOptions !== undefined && ((raw.get(id) as { digest?: string } | undefined)?.digest ?? null) !== saveOptions.expectedDigest) throw new RecommendationCandidateEventConflictError();
      raw.set(id, structuredClone(record));
    },
    async delete(id) { counts.delete += 1; if (fail.delete > 0) { fail.delete -= 1; throw new Error("delete down"); } raw.delete(id); }
  };
  return { store, raw, counts, fail, hooks };
}

function build(store: RecommendationCandidateEventStore, extra: { retentionMs?: number; maxEvents?: number } = {}, clock = { now: NOW }) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T1 });
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  const invalidator = { async invalidate(request: RecommendationDerivedStateInvalidationRequest) { calls.push(request); } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({
    engine, now: () => T1,
    invalidators: { embeddings: invalidator, candidate_cache: createRecommendationCandidateEventDeletionInvalidator(store, invalidator), explanation_cache: invalidator }
  });
  const seen: unknown[] = [];
  const firstSession = { async execute(request: unknown) { seen.push(request); return { recommendations: [] } as never; } };
  const lifecycle = createRecommendationOnboardingLifecycle({
    derived, engine, firstSession, now: () => clock.now,
    candidateEvents: { store, ...extra, retry: { retrySleeper: NO_SLEEP } }
  });
  return { lifecycle, derived, calls, seen, clock };
}

test("reported events survive a restart and keep making the plan less usable", async () => {
  const { store } = rawStore();
  const before = build(store);
  await before.lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  const after = build(store); // new engine, derived and lifecycle over the same store
  assert.deepEqual((await after.lifecycle.listReportedCandidateEvents({ subjectId: A })).map((event) => event.kind), ["member_consent_revoked"]);
  const assessment = await after.lifecycle.assessPlan({ subjectId: A, plan: packPlan() });
  assert.equal(assessment.state, "invalid");
  assert.equal(assessment.usable, false);
  assert.equal(assessment.executable, false);
  assert.deepEqual(assessment.affectedMemberCandidateIds, [candidate("account", "bob").candidateId]);
  // Extra events can only add reasons.
  const more = await after.lifecycle.assessPlan({ subjectId: A, plan: packPlan(), events: [{ kind: "set_deleted", occurredAt: T2, setSourceId: SET_SOURCE_ID }] });
  assert.ok(more.reasons.length >= assessment.reasons.length);
});

test("stored events still exclude candidates and sets on a refresh after a restart", async () => {
  const { store } = rawStore();
  await build(store).lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked, { kind: "set_deleted", occurredAt: T1, setSourceId: SET_SOURCE_ID }], policy: POLICY(A), now: T2 });
  const restarted = build(store);
  const run = await restarted.lifecycle.refresh({ request: { subjectId: A, requestId: "r1" } as never, now: T3 });
  assert.deepEqual(run.excludedCandidateIds, [candidate("account", "bob").candidateId]);
  assert.deepEqual(run.excludedSetSourceIds, [SET_SOURCE_ID]);
  assert.deepEqual((restarted.seen[0] as { excludeSourceIds: string[] }).excludeSourceIds, [SET_SOURCE_ID]);
});

test("replaying a report is idempotent and writes nothing the second time", async () => {
  const { store, counts, raw } = rawStore();
  const { lifecycle } = build(store);
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  const first = JSON.stringify(raw.get(A));
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked, bobRevoked], policy: POLICY(A), now: T3 });
  assert.equal(counts.save, 1);
  assert.equal(JSON.stringify(raw.get(A)), first);
  assert.equal((await lifecycle.listReportedCandidateEvents({ subjectId: A })).length, 1);
});

test("the cap compacts the oldest events and retention drops expired ones", async () => {
  const { store } = rawStore();
  const clock = { now: NOW };
  const { lifecycle } = build(store, { maxEvents: 2, retentionMs: 10 * 60 * 1000 }, clock);
  const event = (name: string) => ({ kind: "account_deleted", occurredAt: T1, candidateId: name }) as const;
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [event("one")], policy: POLICY(A), now: T1 });
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [event("two")], policy: POLICY(A), now: T2 });
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [event("three")], policy: POLICY(A), now: T3 });
  assert.deepEqual((await lifecycle.listReportedCandidateEvents({ subjectId: A, now: T3 })).map((item) => item.candidateId), ["two", "three"]);
  clock.now = "2026-09-26T06:41:00.000Z"; // "two" is 10 minutes old, "three" is 9
  assert.deepEqual((await lifecycle.listReportedCandidateEvents({ subjectId: A })).map((item) => item.candidateId), ["three"]);
  clock.now = "2026-09-26T07:00:00.000Z";
  assert.deepEqual(await lifecycle.listReportedCandidateEvents({ subjectId: A }), []);
  assert.throws(() => build(store, { maxEvents: 5000 }), TypeError);
  assert.throws(() => build(store, { retentionMs: 1 }), TypeError);
});

test("one subject never reads another subject's events, and a record moved between subjects is rejected", async () => {
  const { store, raw } = rawStore();
  const { lifecycle } = build(store);
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  assert.deepEqual(await lifecycle.listReportedCandidateEvents({ subjectId: B }), []);
  raw.set(B, structuredClone(raw.get(A)));
  await assert.rejects(lifecycle.listReportedCandidateEvents({ subjectId: B }), TypeError);
  await assert.rejects(lifecycle.assessPlan({ subjectId: B, plan: packPlan() }), TypeError);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: B, events: [bobRevoked], policy: POLICY(B), now: T2 }), TypeError);
  assert.equal(((raw.get(B) as { subjectId: string }).subjectId), A, "the bad record was not overwritten");
});

test("a tampered or malformed stored record is rejected instead of being read as empty", async () => {
  const { store, raw } = rawStore();
  const { lifecycle } = build(store);
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked, { kind: "set_deleted", occurredAt: T1, setSourceId: SET_SOURCE_ID }], policy: POLICY(A), now: T2 });
  const good = structuredClone(raw.get(A)) as { entries: { event: Record<string, unknown>; recordedAt: string }[]; digest: string; schemaVersion: string };
  const damage: ((record: typeof good) => void)[] = [
    (record) => { record.entries.pop(); },
    (record) => { record.entries[0]!.event.candidateId = "someone-else"; },
    (record) => { record.entries[0]!.recordedAt = "2026-09-26T06:40:00.000Z"; },
    (record) => { record.entries[0]!.event.extra = "x"; },
    (record) => { record.entries.reverse(); },
    (record) => { record.digest = "0".repeat(64); },
    (record) => { record.schemaVersion = "other"; }
  ];
  for (const apply of damage) {
    const copy = structuredClone(good);
    apply(copy);
    raw.set(A, copy);
    await assert.rejects(lifecycle.listReportedCandidateEvents({ subjectId: A }), TypeError);
  }
  for (const junk of [null, "text", [], 7]) {
    raw.set(A, junk);
    await assert.rejects(lifecycle.listReportedCandidateEvents({ subjectId: A }), TypeError);
  }
});

test("a failed save fails the report, retries with backoff, and leaves caches alone", async () => {
  const { store, fail, counts } = rawStore();
  const delays: number[] = [];
  const h = build(store);
  fail.save = 100;
  const lifecycle = createRecommendationOnboardingLifecycle({
    derived: h.derived, engine: createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true }),
    now: () => NOW, candidateEvents: { store, retry: { random: () => 0, retrySleeper: async (ms: number) => { delays.push(ms); } } }
  });
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 }), /save down/);
  assert.equal(counts.save, 4);
  assert.deepEqual(delays.length, 3);
  assert.ok(delays[1]! > delays[0]! && delays[2]! >= delays[1]!, "delays grow");
  assert.equal(h.calls.length, 0);
  // A transient failure is absorbed, and the caches are cleared only after the events are kept.
  fail.save = 2;
  const ok = await h.lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  assert.equal(ok.acceptedEventCount, 1);
  assert.equal((await h.lifecycle.listReportedCandidateEvents({ subjectId: A })).length, 1);
  assert.ok(h.calls.length > 0);
});

test("deleting the subject through the derived orchestrator clears stored events and leaves other subjects alone", async () => {
  const { store, raw } = rawStore();
  const { lifecycle, derived } = build(store);
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  await lifecycle.reportCandidateEvents({ subjectId: B, events: [bobRevoked], policy: POLICY(B), now: T2 });
  await derived.deleteSubject({ subjectId: A, requestedAt: T3, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
  assert.equal(raw.has(A), false);
  assert.deepEqual(await lifecycle.listReportedCandidateEvents({ subjectId: A }), []);
  assert.equal(raw.has(B), true, "other subjects are untouched");
});

test("a report that is mid-save while the subject is deleted leaves its events behind, and deleting again clears them", async () => {
  const { store, raw } = rawStore();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const realSave = store.save.bind(store);
  let saveStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { saveStarted = resolve; });
  const slow: RecommendationCandidateEventStore = {
    ...store,
    async save(id, record) { saveStarted(); await gate; await realSave(id, record); }
  };
  const { lifecycle, derived } = build(slow);
  const pending = lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  await started;
  await derived.deleteSubject({ subjectId: A, requestedAt: T3, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
  release();
  await pending.catch(() => undefined);
  assert.equal(raw.has(A), true, "the deletion does not wait for the in-flight report, so the save lands after it");
  await derived.deleteSubject({ subjectId: A, requestedAt: T3, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
  assert.equal(raw.has(A), false, "a repeated deletion always clears the events");
});

test("withdrawing consent, a denied policy, or a missing policy never leaves events behind or stores new ones", async () => {
  const { store, raw, fail } = rawStore();
  const { lifecycle } = build(store);
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  // No policy: refused before anything is kept, and nothing existing is removed.
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], now: T2 }), TypeError);
  assert.equal(raw.has(A), true);
  // A policy that no longer allows personalization removes what was kept and refuses the report.
  const revoked: RecommendationConsentPolicy = { subjectId: A, allowedDataUses: [], revokedAt: T2 };
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: revoked, now: T3 }), RecommendationConsentDeniedError);
  assert.equal(raw.has(A), false);
  // A policy for a different subject is denied too.
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(B), now: T3 }), RecommendationConsentDeniedError);
  assert.equal(raw.has(A), false);
  // Withdrawal for consent_revoked clears; if the clear fails the withdrawal fails with it.
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  fail.delete = 100;
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: A, reason: "consent_revoked", now: T3 }), /delete down/);
  assert.equal(raw.has(A), true);
  fail.delete = 0;
  await lifecycle.withdrawSelections({ subjectId: A, reason: "consent_revoked", now: T3 });
  assert.equal(raw.has(A), false);
  // Withdrawing for another reason keeps them.
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
  await lifecycle.withdrawSelections({ subjectId: A, reason: "source_retracted", now: T3 });
  assert.equal(raw.has(A), true);
});

test("provider-owned and non-deletable placements are refused when the store is attached", () => {
  for (const manifest of [
    { authority: "provider_owned", processingBoundary: "server_allowed" },
    { persistence: "persistent", userDeletable: false },
    { persistence: "persistent", userExportable: false },
    { domains: ["interest_profile"] }
  ] as const) {
    const { store } = rawStore(manifest as Partial<RecommendationStateStorageAdapterManifest>);
    assert.throws(() => build(store), TypeError, JSON.stringify(manifest));
    assert.throws(() => createRecommendationCandidateEventDeletionInvalidator(store), TypeError);
  }
  const user = rawStore({ authority: "user_owned", processingBoundary: "server_allowed", requiresNetwork: true, supportsOffline: false });
  assert.doesNotThrow(() => build(user.store));
});

test("without a store nothing is persisted, the read helpers refuse, and reporting needs no policy", async () => {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T1 });
  const noop = { async invalidate() { /* nothing cached */ } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => T1, invalidators: { embeddings: noop, candidate_cache: noop, explanation_cache: noop } });
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine, now: () => NOW });
  const result = await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], now: T2 });
  assert.equal(result.acceptedEventCount, 1);
  await assert.rejects(lifecycle.listReportedCandidateEvents({ subjectId: A }), TypeError);
  await assert.rejects(lifecycle.assessPlan({ subjectId: A, plan: packPlan() }), TypeError);
});

const setSensitive = { kind: "set_sensitive", occurredAt: T1, setSourceId: SET_SOURCE_ID } as const;
const benign = (name: string) => ({ kind: "account_deleted", occurredAt: T1, candidateId: name }) as const;

test("a flood of ordinary events cannot push a set-level event out of the cap", async () => {
  const { store } = rawStore();
  const { lifecycle } = build(store, { maxEvents: 3 });
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [setSensitive], policy: POLICY(A), now: T1 });
  for (const [index, name] of ["one", "two", "three", "four", "five"].entries()) {
    await lifecycle.reportCandidateEvents({ subjectId: A, events: [benign(name)], policy: POLICY(A), now: `2026-09-26T06:3${index + 1}:00.000Z` });
  }
  const kept = await lifecycle.listReportedCandidateEvents({ subjectId: A, now: "2026-09-26T06:40:00.000Z" });
  assert.equal(kept.length, 3);
  assert.ok(kept.some((event) => event.kind === "set_sensitive"));
  assert.deepEqual(kept.filter((event) => event.kind === "account_deleted").map((event) => event.candidateId), ["four", "five"]);
});

test("a cap full of set-level events refuses the report instead of dropping a fact", async () => {
  const { store, raw } = rawStore();
  const { lifecycle, calls } = build(store, { maxEvents: 2 });
  await lifecycle.reportCandidateEvents({ subjectId: A, events: [setSensitive, { kind: "set_deleted", occurredAt: T1, setSourceId: SET_SOURCE_ID }], policy: POLICY(A), now: T1 });
  const before = JSON.stringify(raw.get(A));
  const cleared = calls.length;
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("late")], policy: POLICY(A), now: T2 }), TypeError);
  assert.equal(JSON.stringify(raw.get(A)), before);
  assert.equal(calls.length, cleared, "no cache was cleared for a report that was not kept");
});

test("a compare-and-set store keeps both events when two writers race, and a plain store loses one", async () => {
  for (const cas of [true, false]) {
    const { store, raw, hooks } = rawStore(undefined, { cas });
    const first = build(store);
    const second = build(store); // another process: its own engine, so its own queue
    // Load 1 is the dedupe read, load 2 is the merge read. The other writer lands right after load 2.
    hooks.afterLoad = { onLoad: 2, run: async () => { await second.lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("theirs")], policy: POLICY(A), now: T2 }); } };
    await first.lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("mine")], policy: POLICY(A), now: T3 });
    const names = (await build(store).lifecycle.listReportedCandidateEvents({ subjectId: A, now: T3 })).map((event) => event.candidateId).sort();
    assert.deepEqual(names, cas ? ["mine", "theirs"] : ["mine"], cas ? "no event lost" : "single-writer stores lose the other write");
    assert.ok(raw.has(A));
  }
});

test("a store that keeps conflicting gives up with the conflict error", async () => {
  const { store } = rawStore(undefined, { cas: true });
  const original = store.save.bind(store);
  store.save = async () => { throw new RecommendationCandidateEventConflictError(); };
  const { lifecycle, calls } = build(store);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("x")], policy: POLICY(A), now: T1 }), RecommendationCandidateEventConflictError);
  assert.equal(calls.length, 0);
  store.save = original;
});

test("a retried report does not send already stored events to the verifier again", async () => {
  const { store } = rawStore();
  const seen = new Set<string>();
  const replayGuard = { id: "replay-guard", verify(evidence: unknown) { const key = JSON.stringify(evidence); if (seen.has(key)) return { verified: false }; seen.add(key); return { verified: true }; } };
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T1 });
  const invalidator = { async invalidate() { return undefined; } };
  const real = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => T1, invalidators: { embeddings: invalidator, candidate_cache: invalidator, explanation_cache: invalidator } });
  let failClear = 1;
  const derived = {
    process: real.process.bind(real), repair: real.repair.bind(real),
    async invalidateCandidateState(request: Parameters<typeof real.invalidateCandidateState>[0]) {
      if (failClear > 0) { failClear -= 1; throw new Error("cache clear down"); }
      return real.invalidateCandidateState(request);
    }
  };
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine, now: () => NOW, evidenceVerifier: { verifier: replayGuard }, candidateEvents: { store, retry: { retrySleeper: NO_SLEEP } } });
  // The events are verified and stored, then clearing the cache fails. The caller retries.
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("one")], policy: POLICY(A), now: T1 }), /cache clear down/);
  const retry = await lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("one")], policy: POLICY(A), now: T1 });
  assert.equal(retry.evidenceVerification, "unverified", "nothing was sent to the verifier, so the replay guard did not trip");
  assert.equal(retry.storedEventsNotChecked, 1);
  const mixed = await lifecycle.reportCandidateEvents({ subjectId: A, events: [benign("one"), benign("two")], policy: POLICY(A), now: T2 });
  assert.equal(mixed.evidenceVerification, "partial");
  assert.deepEqual(mixed.verifiedKinds, ["lifecycle_event"]);
  assert.equal(mixed.storedEventsNotChecked, 1);
  assert.equal(seen.size, 2);
});

test("refresh refuses an exclusion list that would not fit instead of dropping entries", async () => {
  const { store } = rawStore();
  const { lifecycle, seen } = build(store);
  const ids = Array.from({ length: 5001 }, (_, index) => `id-${index}`);
  await assert.rejects(lifecycle.refresh({ request: { subjectId: A, requestId: "r1", excludeCandidateIds: ids } as never, now: T3 }), /Too many/);
  await assert.rejects(lifecycle.refresh({ request: { subjectId: A, requestId: "r1", excludeSourceIds: ids } as never, now: T3 }), /Too many/);
  assert.equal(seen.length, 0);
  const ok = await lifecycle.refresh({ request: { subjectId: A, requestId: "r1", excludeCandidateIds: ids.slice(0, 5000) } as never, now: T3 });
  assert.equal(ok.excludedCandidateIds.length, 5000);
});

test("refresh and assessPlan with a policy check consent before reading stored events, and denial deletes them", async () => {
  for (const act of ["refresh", "assess"] as const) {
    const { store, raw } = rawStore();
    const { lifecycle } = build(store);
    await lifecycle.reportCandidateEvents({ subjectId: A, events: [bobRevoked], policy: POLICY(A), now: T2 });
    const revoked = { subjectId: A, allowedDataUses: [], privateDataUses: [] } as unknown as RecommendationConsentPolicy;
    const call = act === "refresh"
      ? lifecycle.refresh({ request: { subjectId: A, requestId: "r1" } as never, policy: revoked, now: T3 })
      : lifecycle.assessPlan({ subjectId: A, plan: packPlan(), policy: revoked });
    await assert.rejects(call, RecommendationConsentDeniedError);
    assert.equal(raw.has(A), false, `${act}: stored events were deleted`);
  }
});

test("the in-memory reference store says it is ephemeral and supports compare-and-set", async () => {
  const memory = createInMemoryRecommendationCandidateEventStore();
  assert.equal(memory.manifest.persistence, "ephemeral");
  assert.equal(memory.supportsCompareAndSet, true);
  const record = { schemaVersion: "recommendation-candidate-event-record.v1", subjectId: A, updatedAt: T1, entries: [], digest: "d1" } as never;
  await memory.save(A, record, { expectedDigest: null });
  await assert.rejects(memory.save(A, record, { expectedDigest: null }), RecommendationCandidateEventConflictError);
  await memory.save(A, record, { expectedDigest: "d1" });
});
