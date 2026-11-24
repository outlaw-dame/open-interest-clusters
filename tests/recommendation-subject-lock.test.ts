import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RecommendationConsentDeniedError,
  RECOMMENDATION_SUBJECT_LOCK_DEFAULT_HOLD_MS,
  RECOMMENDATION_SUBJECT_LOCK_MAX_HOLD_MS,
  RecommendationSubjectLockError,
  createInMemoryRecommendationCandidateEventStore,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCatalogIndex,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationOnboardingLifecycle,
  createRecommendationOnboardingSelection,
  type RecommendationConsentPolicy,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationSubjectLockOptions,
  type RecommendationSubjectLockRelease
} from "../src/index.js";

const T0 = "2026-10-01T10:00:00.000Z";
const CATALOG = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);

function policyFor(subjectId: string): RecommendationConsentPolicy {
  return { subjectId, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
}
function change(subjectId: string, policy = policyFor(subjectId)) {
  const selection = createRecommendationOnboardingSelection({ catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming"], selectedCanonicalTagIds: [], allowAutoFollowHashtags: false, selectedAt: T0, storageTarget: "local_app" });
  return { subjectId, catalogIndex: CATALOG, selection, policy, now: T0 };
}

function setup(subjectLock?: RecommendationSubjectLockOptions, log: string[] = []) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T0 });
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const invalidator = (target: string) => ({ async invalidate(request: RecommendationDerivedStateInvalidationRequest) { if (target === "embeddings") log.push(`write:${request.subjectId}`); } });
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({
    engine,
    taskStore: { async load(id) { return tasks.get(id); }, async save(task) { tasks.set(task.subjectId, task); }, async delete(id) { tasks.delete(id); } },
    now: () => T0,
    invalidators: { embeddings: invalidator("embeddings"), candidate_cache: invalidator("c"), explanation_cache: invalidator("e") }
  });
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine, now: () => T0, ...(subjectLock === undefined ? {} : { subjectLock }) });
  return { engine, lifecycle, log };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A fake lock that really excludes per subject and writes what happened to a log. */
function fakeLock(log: string[], extra: Partial<RecommendationSubjectLockOptions> = {}): RecommendationSubjectLockOptions & { maxHeld: () => number } {
  const tails = new Map<string, Promise<void>>();
  let held = 0;
  let maxHeld = 0;
  return {
    async acquire(subjectId) {
      log.push(`acquire:${subjectId}`);
      const prior = tails.get(subjectId) ?? Promise.resolve();
      let free!: () => void;
      tails.set(subjectId, new Promise<void>((resolve) => { free = resolve; }));
      await prior;
      held += 1; maxHeld = Math.max(maxHeld, held);
      log.push(`held:${subjectId}`);
      return () => { held -= 1; log.push(`release:${subjectId}`); free(); };
    },
    maxHeld: () => maxHeld,
    ...extra
  };
}

test("without a subject lock the lifecycle behaves as before", async () => {
  const { lifecycle, engine } = setup();
  const result = await lifecycle.applySelection(change("user-a"));
  assert.ok(result.added.includes("canonical_interest:gaming"));
  assert.equal((await engine.readEventHistory("user-a")).length, result.eventCount);
});

test("the lock brackets the write, and a second call for the same subject waits for the release", async () => {
  const log: string[] = [];
  const { lifecycle } = setup(fakeLock(log), log);
  const first = lifecycle.applySelection(change("user-a"));
  const second = lifecycle.withdrawSelections({ subjectId: "user-a", reason: "source_retracted", now: T0 });
  await Promise.all([first, second]);
  // Queue first, then lock: the second call does not even ask for the lock until the first has released it.
  assert.deepEqual(log.filter((line) => !line.startsWith("write:")).slice(0, 4), ["acquire:user-a", "held:user-a", "release:user-a", "acquire:user-a"]);
  const firstWrite = log.indexOf("write:user-a");
  assert.ok(log.indexOf("held:user-a") < firstWrite && firstWrite < log.indexOf("release:user-a"));
});

test("writes for one subject never overlap under the lock, and different subjects do not block each other", async () => {
  // This lock does not exclude anything. It only records overlap, so any overlap seen
  // for one subject means the in-process queue let two writers through to the lock.
  const holders = new Map<string, number>();
  let sameSubjectOverlap = false;
  const watcher: RecommendationSubjectLockOptions = {
    async acquire(subjectId) {
      const now = (holders.get(subjectId) ?? 0) + 1;
      holders.set(subjectId, now);
      if (now > 1) sameSubjectOverlap = true;
      await tick();
      return () => { holders.set(subjectId, holders.get(subjectId)! - 1); };
    }
  };
  const { lifecycle } = setup(watcher);
  await Promise.all([lifecycle.applySelection(change("user-a")), lifecycle.applySelection(change("user-a")), lifecycle.applySelection(change("user-b"))]);
  assert.equal(sameSubjectOverlap, false);

  // Both subjects must hold their locks at once before either may proceed. A shared lock would deadlock here.
  const arrived = new Set<string>();
  let open!: () => void;
  const both = new Promise<void>((resolve) => { open = resolve; });
  const barrier: RecommendationSubjectLockOptions = {
    async acquire(subjectId) {
      arrived.add(subjectId);
      if (arrived.size === 2) open();
      await both;
      return () => undefined;
    },
    timeoutMs: 2000
  };
  const second = setup(barrier);
  await Promise.all([second.lifecycle.applySelection(change("user-c")), second.lifecycle.applySelection(change("user-d"))]);
  assert.equal(arrived.size, 2);
});

test("a failing acquire fails closed and nothing is written", async () => {
  for (const acquire of [
    async () => { throw new Error("db down"); },
    () => { throw new Error("sync boom"); }
  ] as RecommendationSubjectLockOptions["acquire"][]) {
    const log: string[] = [];
    const { lifecycle, engine } = setup({ acquire }, log);
    const error = await lifecycle.applySelection(change("user-a")).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof RecommendationSubjectLockError);
    assert.equal(error.reason, "acquire_failed");
    assert.ok(!error.message.includes("user-a"));
    assert.equal((await engine.readEventHistory("user-a")).length, 0);
    assert.deepEqual(log, []);
  }
});

test("a failed acquire does not wedge the queue for later calls", async () => {
  let fail = true;
  const { lifecycle, engine } = setup({ async acquire() { if (fail) throw new Error("once"); return () => undefined; } });
  await assert.rejects(lifecycle.applySelection(change("user-a")), RecommendationSubjectLockError);
  fail = false;
  await lifecycle.applySelection(change("user-a"));
  assert.ok((await engine.readEventHistory("user-a")).length > 0);
});

test("the lock is released when the write throws, and the original error comes through", async () => {
  const log: string[] = [];
  const { lifecycle, engine } = setup(fakeLock(log), log);
  const denied: RecommendationConsentPolicy = { subjectId: "user-a", allowedDataUses: [], privateDataUses: [] };
  await assert.rejects(lifecycle.applySelection(change("user-a", denied)), RecommendationConsentDeniedError);
  assert.deepEqual(log, ["acquire:user-a", "held:user-a", "release:user-a"]);
  assert.equal((await engine.readEventHistory("user-a")).length, 0);
});

test("a throwing release keeps the result and is reported to onReleaseError", async () => {
  const reported: RecommendationSubjectLockError[] = [];
  const { lifecycle, engine } = setup({
    async acquire() { return () => { throw new Error("release broke"); }; },
    onReleaseError: (error) => { reported.push(error); throw new Error("reporter broke too"); }
  });
  const result = await lifecycle.applySelection(change("user-a"));
  assert.ok(result.added.length > 0);
  assert.equal((await engine.readEventHistory("user-a")).length, result.eventCount);
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.reason, "release_failed");
  assert.equal((reported[0]!.cause as Error).message, "release broke");
});

test("a throwing release does not replace the error of the write", async () => {
  const reported: string[] = [];
  const { lifecycle } = setup({ async acquire() { return async () => { throw new Error("release broke"); }; }, onReleaseError: (e) => reported.push(e.reason) });
  const denied: RecommendationConsentPolicy = { subjectId: "user-a", allowedDataUses: [], privateDataUses: [] };
  await assert.rejects(lifecycle.applySelection(change("user-a", denied)), RecommendationConsentDeniedError);
  assert.deepEqual(reported, ["release_failed"]);
});

test("a release that hangs is abandoned after the timeout and does not block the result", async () => {
  const reported: string[] = [];
  const { lifecycle } = setup({ async acquire() { return () => new Promise<void>(() => undefined); }, timeoutMs: 20, onReleaseError: (e) => reported.push(e.reason) });
  const result = await lifecycle.applySelection(change("user-a"));
  assert.ok(result.added.length > 0);
  assert.deepEqual(reported, ["release_timeout"]);
});

test("the release function is called exactly once per write", async () => {
  let releases = 0;
  const { lifecycle } = setup({ async acquire() { return () => { releases += 1; }; } });
  await lifecycle.applySelection(change("user-a"));
  assert.equal(releases, 1);
});

test("an acquire that never answers times out, aborts its signal, and writes nothing", async () => {
  let signal: AbortSignal | undefined;
  const { lifecycle, engine } = setup({ acquire(_id, options) { signal = options.signal; return new Promise(() => undefined); }, timeoutMs: 20 });
  const error = await lifecycle.applySelection(change("user-a")).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof RecommendationSubjectLockError);
  assert.equal(error.reason, "acquire_timeout");
  assert.equal(signal?.aborted, true);
  assert.equal((await engine.readEventHistory("user-a")).length, 0);
});

test("a lock granted after the timeout is given straight back", async () => {
  let grant!: (release: RecommendationSubjectLockRelease) => void;
  let released = 0;
  const { lifecycle } = setup({ acquire() { return new Promise((resolve) => { grant = resolve; }); }, timeoutMs: 20 });
  await assert.rejects(lifecycle.applySelection(change("user-a")), RecommendationSubjectLockError);
  grant(() => { released += 1; });
  await tick();
  assert.equal(released, 1);
});

test("aborting the lifecycle signal stops the wait, and an already aborted signal never reaches acquire", async () => {
  const controller = new AbortController();
  let calls = 0;
  let seen: AbortSignal | undefined;
  const { lifecycle, engine } = setup({ acquire(_id, options) { calls += 1; seen = options.signal; return new Promise(() => undefined); }, signal: controller.signal, timeoutMs: 5000 });
  const pending = lifecycle.applySelection(change("user-a"));
  await tick();
  controller.abort();
  const error = await pending.then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof RecommendationSubjectLockError);
  assert.equal(error.reason, "aborted");
  assert.equal(seen?.aborted, true);
  const callsBefore = calls;
  await assert.rejects(lifecycle.applySelection(change("user-a")), (e: unknown) => e instanceof RecommendationSubjectLockError && e.reason === "aborted");
  assert.equal(calls, callsBefore);
  assert.equal((await engine.readEventHistory("user-a")).length, 0);
});

test("a lock that resolves to something other than a release function is refused", async () => {
  const { lifecycle, engine } = setup({ acquire: (async () => ({ release() {} })) as unknown as RecommendationSubjectLockOptions["acquire"] });
  await assert.rejects(lifecycle.applySelection(change("user-a")), (e: unknown) => e instanceof RecommendationSubjectLockError && e.reason === "invalid_release");
  assert.equal((await engine.readEventHistory("user-a")).length, 0);
});

test("malformed lock options are rejected when the lifecycle is created", () => {
  const good = async () => () => undefined;
  for (const bad of [null, "lock", {}, { acquire: good, timeoutMs: 0 }, { acquire: good, timeoutMs: 60_001 }, { acquire: good, timeoutMs: 1.5 }, { acquire: good, signal: {} }, { acquire: good, onReleaseError: 1 }]) {
    assert.throws(() => setup(bad as unknown as RecommendationSubjectLockOptions), TypeError);
  }
});

// The other three wrapped methods. Each one has to take the lock, give it back, and fail closed
// without touching anything when the lock cannot be had.
function setupWithStoreAndFirstSession(subjectLock: RecommendationSubjectLockOptions, log: string[]) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T0 });
  const noop = { async invalidate(request: RecommendationDerivedStateInvalidationRequest) { log.push(`invalidate:${request.subjectId}`); } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({
    engine, now: () => T0, invalidators: { embeddings: noop, candidate_cache: noop, explanation_cache: noop }
  });
  const store = createInMemoryRecommendationCandidateEventStore();
  const saves: string[] = [];
  const loggedStore = { ...store, manifest: store.manifest, load: (id: string) => store.load(id), delete: (id: string) => store.delete(id), async save(id: string, record: never, saveOptions?: never) { saves.push(id); return store.save(id, record, saveOptions); } };
  const firstSession = { async execute() { log.push("first-session"); return { recommendations: [] } as never; } };
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine, firstSession, subjectLock, now: () => T0, candidateEvents: { store: loggedStore } });
  return { lifecycle, saves };
}

const SET_DELETED = { kind: "set_deleted", occurredAt: T0, setSourceId: "curated-set:v1:x", candidateId: "pack-1" } as const;
function lockedCalls(lifecycle: ReturnType<typeof setupWithStoreAndFirstSession>["lifecycle"]): Record<string, () => Promise<unknown>> {
  return {
    reportCandidateEvents: () => lifecycle.reportCandidateEvents({ subjectId: "user-a", events: [SET_DELETED], policy: policyFor("user-a"), now: T0 }),
    assessPlan: () => lifecycle.assessPlan({ subjectId: "user-a", plan: undefined as never, policy: policyFor("user-a"), now: T0 }),
    refresh: () => lifecycle.refresh({ request: { subjectId: "user-a", requestId: "r1", languages: ["en"], limit: 5 }, now: T0 })
  };
}

test("reportCandidateEvents, assessPlan and refresh each take the lock and give it back, even when they throw", async () => {
  for (const name of ["reportCandidateEvents", "assessPlan", "refresh"]) {
    const log: string[] = [];
    const { lifecycle } = setupWithStoreAndFirstSession(fakeLock(log), log);
    // assessPlan gets no usable plan here, so it throws after the lock is taken. That is the point: release still happens.
    await lockedCalls(lifecycle)[name]!().catch(() => undefined);
    const lockLog = log.filter((entry) => /^(acquire|held|release):/u.test(entry));
    assert.deepEqual(lockLog, ["acquire:user-a", "held:user-a", "release:user-a"], name);
    if (name === "refresh") assert.ok(log.indexOf("first-session") > log.indexOf("held:user-a") && log.indexOf("first-session") < log.indexOf("release:user-a"), "first session runs inside the lock");
    if (name === "reportCandidateEvents") assert.ok(log.indexOf("invalidate:user-a") > log.indexOf("held:user-a") && log.indexOf("invalidate:user-a") < log.indexOf("release:user-a"), "cache clearing runs inside the lock");
  }
});

test("reportCandidateEvents, assessPlan and refresh fail closed when the lock cannot be had", async () => {
  for (const name of ["reportCandidateEvents", "assessPlan", "refresh"]) {
    const log: string[] = [];
    const { lifecycle, saves } = setupWithStoreAndFirstSession({ async acquire() { throw new Error("db down"); } }, log);
    const error = await lockedCalls(lifecycle)[name]!().then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof RecommendationSubjectLockError, name);
    assert.equal(error.reason, "acquire_failed", name);
    assert.ok(!error.message.includes("user-a"), name);
    // Nothing ran: no event saved, no cache cleared, no first-session call.
    assert.deepEqual(saves, [], name);
    assert.deepEqual(log, [], name);
    assert.deepEqual(await lifecycle.listReportedCandidateEvents({ subjectId: "user-a" }), [], name);
  }
});

// Hold deadline. These use real timers with a few milliseconds of margin, because the deadline is a real timer.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
}
const REFRESH = { request: { subjectId: "user-a", requestId: "r1", languages: ["en"], limit: 5 }, now: T0 };

function setupHold(subjectLock: RecommendationSubjectLockOptions, log: string[], firstSession: { execute(request: { signal?: AbortSignal }): Promise<never> }, verifier?: { id: string; verify(evidence: unknown, context: { signal: AbortSignal }): Promise<{ verified: boolean }> }) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T0 });
  const noop = { async invalidate(request: RecommendationDerivedStateInvalidationRequest) { log.push(`invalidate:${request.subjectId}`); } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => T0, invalidators: { embeddings: noop, candidate_cache: noop, explanation_cache: noop } });
  const store = createInMemoryRecommendationCandidateEventStore();
  const saves: string[] = [];
  const loggedStore = { ...store, manifest: store.manifest, load: (id: string) => store.load(id), delete: (id: string) => store.delete(id), async save(id: string, record: never, saveOptions?: never) { saves.push(id); return store.save(id, record, saveOptions); } };
  const lifecycle = createRecommendationOnboardingLifecycle({
    derived, engine, firstSession: firstSession as never, subjectLock, now: () => T0, candidateEvents: { store: loggedStore },
    ...(verifier === undefined ? {} : { evidenceVerifier: { verifier } as never })
  });
  return { lifecycle, saves };
}

test("work that honors the abort stops, the lock is freed afterwards, and the call fails with hold_exceeded", async () => {
  const log: string[] = [];
  const told: RecommendationSubjectLockError[] = [];
  const lock = fakeLock(log, { maxHoldMs: 20, onHoldExceeded: (e) => { told.push(e); log.push("told"); } });
  const { lifecycle } = setupHold(lock, log, {
    execute: (request) => new Promise<never>((_, reject) => {
      log.push("first-session");
      request.signal!.addEventListener("abort", () => { log.push("work-stopped"); reject(new Error("aborted for user-a")); }, { once: true });
    })
  });
  const error = await lifecycle.refresh(REFRESH).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof RecommendationSubjectLockError);
  assert.equal(error.reason, "hold_exceeded");
  assert.ok(!error.message.includes("user-a"));
  assert.equal(error.cause, undefined, "the work's own error, which may name the subject, is not carried along");
  assert.equal(told.length, 1);
  assert.ok(!told[0]!.message.includes("user-a"));
  const line = log.filter((entry) => ["held:user-a", "told", "work-stopped", "release:user-a"].includes(entry));
  assert.deepEqual(line.slice(0, 1).concat(line.slice(-1)), ["held:user-a", "release:user-a"]);
  assert.ok(log.indexOf("work-stopped") < log.indexOf("release:user-a"));
  // The queue is not wedged afterwards.
  const again = await setupHold(fakeLock([]), [], { execute: async () => ({ recommendations: [] }) as never }).lifecycle.refresh(REFRESH);
  assert.ok(again);
});

test("work that ignores the abort keeps the lock until it settles, so a second contender never overlaps it", async () => {
  const log: string[] = [];
  const lock = fakeLock(log, { maxHoldMs: 20, onHoldExceeded: () => log.push("told") });
  const stuck = gate();
  const { lifecycle } = setupHold(lock, log, { execute: async () => { log.push("work-start"); await stuck.opened; log.push("work-end"); return { recommendations: [] } as never; } });
  const call = lifecycle.refresh(REFRESH).then(() => undefined, (e: unknown) => e);
  await sleep(10);
  // A second writer, as another tab or device would be, asks for the same subject's lock.
  const contender = lock.acquire("user-a", { signal: new AbortController().signal }).then((release) => { log.push("contender-held"); return release; });
  await sleep(80);
  assert.ok(log.includes("told"), "the app was told once the deadline passed");
  assert.ok(!log.includes("contender-held"), "the lock was not given away at the deadline");
  assert.ok(!log.includes("release:user-a"));
  assert.equal(lock.maxHeld(), 1);
  stuck.open();
  const error = await call;
  assert.ok(error instanceof RecommendationSubjectLockError && error.reason === "hold_exceeded");
  (await contender)();
  assert.ok(log.indexOf("work-end") < log.indexOf("contender-held"), "the contender got the lock only after the work settled");
  assert.equal(lock.maxHeld(), 1, "never two holders at once");
});

test("a late success still fails closed, and no new store write starts after the deadline", async () => {
  const log: string[] = [];
  const { lifecycle, saves } = setupHold(fakeLock(log, { maxHoldMs: 20 }), log, { execute: async () => ({ recommendations: [] }) as never }, {
    id: "slow",
    // The verifier is given the abort. The library stops waiting for it, so it may still be finishing after the call has failed.
    verify: async (_evidence, context) => { await sleep(60); log.push(`verifier-aborted:${context.signal.aborted}`); return { verified: true }; }
  });
  const error = await lifecycle.reportCandidateEvents({ subjectId: "user-a", events: [SET_DELETED], policy: policyFor("user-a"), now: T0 }).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof RecommendationSubjectLockError && error.reason === "hold_exceeded");
  await sleep(80);
  assert.ok(log.includes("verifier-aborted:true"), "the verifier saw the abort");
  assert.deepEqual(saves, [], "the deadline passed before the save, so it never started");
  assert.ok(!log.includes("invalidate:user-a"));
  assert.ok(log.includes("release:user-a"));
});

test("the deadline never fires when the work finishes in time, and its timer is cleared", async () => {
  const log: string[] = [];
  let seen: AbortSignal | undefined;
  const lock = fakeLock(log, { maxHoldMs: 40, onHoldExceeded: () => log.push("told") });
  const { lifecycle } = setupHold(lock, log, { execute: async (request) => { seen = request.signal; return { recommendations: [] } as never; } });
  await lifecycle.refresh(REFRESH);
  await sleep(90);
  assert.ok(!log.includes("told"));
  assert.equal(seen?.aborted, false);
});

test("aborting during acquire fails with aborted and never starts the hold timer", async () => {
  const controller = new AbortController();
  const told: string[] = [];
  const lock: RecommendationSubjectLockOptions = {
    acquire: () => new Promise(() => undefined),
    maxHoldMs: 10,
    signal: controller.signal,
    onHoldExceeded: () => told.push("told")
  };
  const { lifecycle, saves } = setupHold(lock, [], { execute: async () => ({ recommendations: [] }) as never });
  const call = lifecycle.refresh(REFRESH).then(() => undefined, (e: unknown) => e);
  await sleep(5);
  controller.abort();
  const error = await call;
  assert.ok(error instanceof RecommendationSubjectLockError && error.reason === "aborted");
  await sleep(30);
  assert.deepEqual(told, []);
  assert.deepEqual(saves, []);
});

test("a throwing or rejecting onHoldExceeded changes nothing", async () => {
  for (const onHoldExceeded of [
    () => { throw new Error("alert service down"); },
    () => Promise.reject(new Error("alert service down")) as unknown as void
  ]) {
    const log: string[] = [];
    const { lifecycle } = setupHold(fakeLock(log, { maxHoldMs: 15, onHoldExceeded }), log, {
      execute: (request) => new Promise<never>((_, reject) => request.signal!.addEventListener("abort", () => reject(new Error("stop")), { once: true }))
    });
    const error = await lifecycle.refresh(REFRESH).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof RecommendationSubjectLockError && error.reason === "hold_exceeded");
    assert.ok(log.includes("release:user-a"));
  }
  await sleep(10);
});

test("with a deadline set, the order stays engine queue, then lock, then store queue", async () => {
  const log: string[] = [];
  const { lifecycle } = setupHold(fakeLock(log, { maxHoldMs: 5_000 }), log, { execute: async () => ({ recommendations: [] }) as never });
  const first = lifecycle.reportCandidateEvents({ subjectId: "user-a", events: [SET_DELETED], policy: policyFor("user-a"), now: T0 });
  const second = lifecycle.reportCandidateEvents({ subjectId: "user-a", events: [SET_DELETED], policy: policyFor("user-a"), now: T0 });
  await Promise.all([first, second]);
  const lockLog = log.filter((entry) => /^(acquire|held|release):/u.test(entry));
  assert.deepEqual(lockLog, ["acquire:user-a", "held:user-a", "release:user-a", "acquire:user-a", "held:user-a", "release:user-a"]);
  assert.ok(log.indexOf("invalidate:user-a") > log.indexOf("held:user-a") && log.indexOf("invalidate:user-a") < log.indexOf("release:user-a"));
});

test("maxHoldMs and onHoldExceeded are validated", () => {
  const good = async () => () => undefined;
  for (const bad of [{ maxHoldMs: 0 }, { maxHoldMs: 300_001 }, { maxHoldMs: 1.5 }, { maxHoldMs: "5" }, { onHoldExceeded: 1 }]) {
    assert.throws(() => setup({ acquire: good, ...bad } as unknown as RecommendationSubjectLockOptions), TypeError);
  }
  assert.doesNotThrow(() => setup({ acquire: good, maxHoldMs: 300_000, onHoldExceeded: () => undefined }));
  assert.equal(RECOMMENDATION_SUBJECT_LOCK_DEFAULT_HOLD_MS, 60_000);
  assert.equal(RECOMMENDATION_SUBJECT_LOCK_MAX_HOLD_MS, 300_000);
});
