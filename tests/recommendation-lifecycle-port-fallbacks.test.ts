import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION,
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  createInMemoryRecommendationCandidateEventStore,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCatalogIndex,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationOnboardingLifecycle,
  createRecommendationOnboardingSelection,
  readRecommendationCandidateEventRecord,
  type RecommendationConsentPolicy,
  type RecommendationDerivedStateInvalidationOrchestrator,
  type RecommendationEngineOrchestrator
} from "../src/index.js";

// These tests stand in for an application that wraps or re-implements the engine and derived-state
// ports and does not know about the newer optional members.

const SUBJECT = "user-123";
const T0 = "2026-10-01T10:00:00.000Z";
const CATALOG = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
const EVENT = { kind: "set_deleted", occurredAt: T0, setSourceId: "curated-set:v1:x" } as const;

function selectionChange() {
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming"], selectedCanonicalTagIds: [],
    allowAutoFollowHashtags: false, selectedAt: T0, storageTarget: "local_app"
  });
  return { subjectId: SUBJECT, catalogIndex: CATALOG, selection, policy: POLICY, now: T0 };
}

function build() {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T0 });
  const invalidations: string[] = [];
  const noop = { async invalidate() { invalidations.push("called"); } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => T0, invalidators: { embeddings: noop, candidate_cache: noop, explanation_cache: noop } });
  // Hand-written wrappers that only know the original port members.
  const plainEngine: RecommendationEngineOrchestrator = {
    process: (input) => engine.process(input),
    synchronize: (input) => engine.synchronize(input),
    readProfile: (id) => engine.readProfile(id),
    readLedgerSnapshot: (input) => engine.readLedgerSnapshot(input),
    deleteSubject: (intent) => engine.deleteSubject(intent)
  };
  const plainDerived: RecommendationDerivedStateInvalidationOrchestrator = {
    process: (input) => derived.process(input),
    synchronize: (input) => derived.synchronize(input),
    repair: (id) => derived.repair(id),
    deleteSubject: (intent) => derived.deleteSubject(intent)
  };
  return { engine, derived, plainEngine, plainDerived, invalidations };
}

test("an engine without readEventHistory is accepted, and selection changes fail before any write", async () => {
  const { derived, plainEngine, engine, invalidations } = build();
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine: plainEngine, now: () => T0 });
  await assert.rejects(lifecycle.applySelection(selectionChange()), /needs an engine with readEventHistory/u);
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "source_retracted", now: T0 }), /needs an engine with readEventHistory/u);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, 0);
  assert.equal(invalidations.length, 0);
});

test("an engine without readEventHistory still lets candidate events be reported", async () => {
  const { derived, plainEngine, invalidations } = build();
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine: plainEngine, now: () => T0 });
  const result = await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [EVENT], now: T0 });
  assert.equal(result.acceptedEventCount, 1);
  assert.ok(invalidations.length > 0);
});

test("a derived-state port without invalidateCandidateState is accepted, selections still work", async () => {
  const { plainDerived, engine, invalidations } = build();
  const lifecycle = createRecommendationOnboardingLifecycle({ derived: plainDerived, engine, now: () => T0 });
  const result = await lifecycle.applySelection(selectionChange());
  assert.ok(result.added.length > 0);
  assert.ok(invalidations.length > 0);
});

test("without invalidateCandidateState a report fails first, before consent is read or anything is stored", async () => {
  const { plainDerived, engine } = build();
  const store = createInMemoryRecommendationCandidateEventStore();
  let touched = 0;
  const watched = { ...store, manifest: store.manifest, supportsCompareAndSet: true as const,
    load: async (id: string) => { touched += 1; return store.load(id); },
    save: async (...args: Parameters<typeof store.save>) => { touched += 1; return store.save(...args); },
    delete: async (id: string) => { touched += 1; return store.delete(id); } };
  const lifecycle = createRecommendationOnboardingLifecycle({ derived: plainDerived, engine, now: () => T0, candidateEvents: { store: watched } });
  // No policy is passed. The port error must still come first, so no consent decision or store call happened.
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [EVENT], now: T0 }), /needs a derived-state orchestrator with invalidateCandidateState/u);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [EVENT], policy: POLICY, now: T0 }), /needs a derived-state orchestrator with invalidateCandidateState/u);
  assert.equal(touched, 0);
  assert.equal(await store.load(SUBJECT), undefined);
});

test("without invalidateCandidateState, refresh works when nothing is reported and fails when events are", async () => {
  const { plainDerived, engine } = build();
  const executed: unknown[] = [];
  const firstSession = { async execute(request: unknown) { executed.push(request); return {} as never; } };
  const lifecycle = createRecommendationOnboardingLifecycle({ derived: plainDerived, engine, firstSession, now: () => T0 });
  const request = { subjectId: SUBJECT, requestId: "r1", languages: ["en"], limit: 5 };
  await lifecycle.refresh({ request, now: T0 });
  assert.equal(executed.length, 1);
  await assert.rejects(lifecycle.refresh({ request, candidateEvents: [EVENT], now: T0 }), /needs a derived-state orchestrator with invalidateCandidateState/u);
  assert.equal(executed.length, 1);
});

test("an optional member that is present but not a function is still refused at creation", () => {
  const { derived, engine, plainDerived, plainEngine } = build();
  assert.throws(() => createRecommendationOnboardingLifecycle({ derived, engine: { ...plainEngine, readEventHistory: "nope" as never } }), TypeError);
  assert.throws(() => createRecommendationOnboardingLifecycle({ derived: { ...plainDerived, invalidateCandidateState: 1 as never }, engine }), TypeError);
});

test("the factories still return the extension members, so existing callers of the package engine are unaffected", async () => {
  const { engine, derived } = build();
  assert.equal(typeof engine.readEventHistory, "function");
  assert.equal(typeof derived.invalidateCandidateState, "function");
});

test("a stored record from a later schema version is refused with a message that says so", () => {
  const limits = { retentionMs: 60_000 * 60, maxEvents: 10 };
  const newer = { schemaVersion: "recommendation-candidate-event-record.v2", subjectId: SUBJECT, entries: [], updatedAt: T0, digest: "x", extra: true };
  assert.throws(() => readRecommendationCandidateEventRecord(newer, SUBJECT, limits, T0), /Unsupported recommendation candidate event record schema version/u);
  // Anything else that does not match stays a plain invalid record.
  for (const schemaVersion of ["something-else.v1", "recommendation-candidate-event-record.vx", 2, undefined]) {
    assert.throws(() => readRecommendationCandidateEventRecord({ ...newer, schemaVersion }, SUBJECT, limits, T0), /Invalid stored recommendation candidate event record/u);
  }
  assert.equal(RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION, "recommendation-candidate-event-record.v1");
});
