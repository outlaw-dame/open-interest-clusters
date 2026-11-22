import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RecommendationConsentDeniedError,
  RecommendationDerivedStateInvalidationPendingError,
  buildColdStartScoringInput,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCandidateId,
  createRecommendationCatalogIndex,
  createRecommendationCuratedAccountSetCandidateSourceAdapter,
  createRecommendationCuratedAccountSetSourceId,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEmbeddingSourceFingerprint,
  createRecommendationEngineOrchestrator,
  createRecommendationFirstSessionOrchestrator,
  createRecommendationOnboardingLifecycle,
  createRecommendationOnboardingSelection,
  type RecommendationCandidate,
  type RecommendationCandidateKind,
  type RecommendationCandidateSourceAdapter,
  type RecommendationConsentPolicy,
  type RecommendationCuratedAccountSet,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateTarget,
  type RecommendationEvidenceVerifierOptions,
  RecommendationEvidenceVerificationError,
  type RecommendationOnboardingLifecycle,
  type RecommendationOnboardingLifecycleWithCandidateEvents,
  type RecommendationSignalLedgerEventInput
} from "../src/index.js";

const SUBJECT = "user-123";
const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T11:00:00.000Z";
const T2 = "2026-10-01T12:00:00.000Z";
const CATALOG = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };

function selection(topics: readonly string[], tags: readonly string[] = [], selectedAt = T0) {
  return createRecommendationOnboardingSelection({ catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: topics, selectedCanonicalTagIds: tags, allowAutoFollowHashtags: false, selectedAt, storageTarget: "local_app" });
}
function change(topics: readonly string[], now = T0, extra: Record<string, unknown> = {}, tags: readonly string[] = []) {
  return { subjectId: SUBJECT, catalogIndex: CATALOG, selection: selection(topics, tags, now), policy: POLICY, now, ...extra };
}

// The lifecycle clock sits at the latest time these tests pass in, so explicit times are never ahead of it.
let lifecycleClock = T2;

function harness(options: { failures?: RecommendationDerivedStateTarget[]; firstSessionSources?: readonly RecommendationCandidateSourceAdapter[]; candidateKinds?: readonly RecommendationCandidateKind[]; evidenceVerifier?: RecommendationEvidenceVerifierOptions } = {}) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => T0 });
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const failures = options.failures ?? [];
  const invalidator = (target: RecommendationDerivedStateTarget) => ({
    async invalidate(request: RecommendationDerivedStateInvalidationRequest) {
      calls.push(request);
      const index = failures.indexOf(target);
      if (index >= 0) { failures.splice(index, 1); throw new Error("injected"); }
    }
  });
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({
    engine,
    taskStore: { async load(id) { return tasks.get(id); }, async save(task) { tasks.set(task.subjectId, task); }, async delete(id) { tasks.delete(id); } },
    now: () => T0,
    invalidators: { embeddings: invalidator("embeddings"), candidate_cache: invalidator("candidate_cache"), explanation_cache: invalidator("explanation_cache") }
  });
  const firstSessionCalls: unknown[] = [];
  const firstSession = options.firstSessionSources === undefined ? undefined : createRecommendationFirstSessionOrchestrator({
    engine,
    sources: options.firstSessionSources,
    candidateKinds: options.candidateKinds ?? ["account"],
    evaluateEligibility: ({ candidate }) => { firstSessionCalls.push(candidate.candidate.candidateId); return { candidate: candidate.candidate, eligible: true, reasonCodes: ["eligible"], evaluatedAt: T0 }; }
  });
  const lifecycle: RecommendationOnboardingLifecycleWithCandidateEvents = createRecommendationOnboardingLifecycle({ derived, engine, ...(firstSession === undefined ? {} : { firstSession }), now: () => lifecycleClock, ...(options.evidenceVerifier === undefined ? {} : { evidenceVerifier: options.evidenceVerifier }) });
  return { engine, derived, lifecycle, calls, tasks, firstSessionCalls };
}

function activeKeys(profile: { entries: readonly { target: { kind: string; key: string } }[] }): string[] {
  return profile.entries.map((entry) => `${entry.target.kind}:${entry.target.key}`).sort();
}

test("the first selection writes onboarding signals and clears derived state once", async () => {
  const { lifecycle, engine, calls } = harness();
  const result = await lifecycle.applySelection(change(["gaming"]));
  assert.ok(result.added.includes("canonical_interest:gaming"));
  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.removed, []);
  assert.equal(result.unchangedCount, 0);
  assert.equal(result.eventCount, result.added.length);
  assert.equal(result.processing.propagation.reason, "profile_changed");
  assert.deepEqual(calls.map((call) => call.target), ["embeddings", "candidate_cache", "explanation_cache"]);
  assert.ok(activeKeys(await engine.readProfile(SUBJECT)).includes("canonical_interest:gaming"));
});

test("a profile store smuggled into a selection change is rejected and nothing is written", async () => {
  const { lifecycle, engine } = harness();
  let ingested = false;
  const rogueStore = { async ingestSignals() { ingested = true; throw new Error("must not be called"); } };
  await assert.rejects(lifecycle.applySelection(change(["gaming"], T0, { profileStore: rogueStore })), TypeError);
  assert.equal(ingested, false);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, 0);
});

test("rerunning the same selection is a no-op, even at a later time", async () => {
  const { lifecycle, engine, calls } = harness();
  const first = await lifecycle.applySelection(change(["gaming"]));
  const historyBefore = (await engine.readEventHistory(SUBJECT)).length;
  calls.length = 0;
  for (const when of [T0, T1, T2]) {
    const again = await lifecycle.applySelection(change(["gaming"], when));
    assert.equal(again.eventCount, 0);
    assert.equal(again.unchangedCount, first.added.length);
    assert.deepEqual([again.added, again.updated, again.removed], [[], [], []]);
    assert.equal(again.processing.propagation.changed, false);
  }
  assert.equal((await engine.readEventHistory(SUBJECT)).length, historyBefore);
  assert.deepEqual(calls, []);
});

test("removing a selection retracts its signals instead of only writing a new snapshot", async () => {
  const { lifecycle, engine, calls } = harness();
  await lifecycle.applySelection(change(["gaming", "technology"]));
  const before = activeKeys(await engine.readProfile(SUBJECT));
  calls.length = 0;
  const result = await lifecycle.applySelection(change(["technology"], T1));
  assert.ok(result.removed.includes("canonical_interest:gaming"));
  assert.equal(result.processing.propagation.reason, "signal_retracted");
  assert.deepEqual(calls.map((call) => call.target), ["embeddings", "candidate_cache", "explanation_cache"]);
  const after = activeKeys(await engine.readProfile(SUBJECT));
  assert.ok(before.includes("canonical_interest:gaming") && !after.includes("canonical_interest:gaming"));
  assert.ok(after.includes("canonical_interest:technology"));
  const snapshot = await engine.readLedgerSnapshot({ subjectId: SUBJECT, now: T1 });
  assert.equal(snapshot.tombstones.length, result.removed.length);
  assert.ok(snapshot.tombstones.every((tombstone) => tombstone.reason === "source_retracted"));
});

test("a selection added back after removal is written again instead of being suppressed by the old tombstone", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming"]));
  await lifecycle.applySelection(change(["technology"], T1));
  const back = await lifecycle.applySelection(change(["gaming"], T2));
  assert.ok(back.added.includes("canonical_interest:gaming"));
  assert.equal(back.processing.engine.ingestion.suppressedCount, 0);
  assert.ok(activeKeys(await engine.readProfile(SUBJECT)).includes("canonical_interest:gaming"));
  const ids = (await engine.readEventHistory(SUBJECT)).filter((event) => event.operation === "apply").map((event) => event.sourceEventId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.some((id) => id.includes(":g1:")));
});

test("changing expiry replaces the live signal and keeps exactly one active copy", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming"], T0, { expiresAt: "2026-12-01T00:00:00.000Z" }));
  const edited = await lifecycle.applySelection(change(["gaming"], T1, { expiresAt: "2027-01-01T00:00:00.000Z" }));
  assert.ok(edited.updated.includes("canonical_interest:gaming"));
  assert.deepEqual(edited.added, []);
  const snapshot = await engine.readLedgerSnapshot({ subjectId: SUBJECT, now: T1 });
  const gaming = snapshot.activeSignals.filter((entry) => entry.signal.target.key === "gaming" && entry.signal.target.kind === "canonical_interest");
  assert.equal(gaming.length, 1);
  assert.equal(gaming[0]?.signal.expiresAt, "2027-01-01T00:00:00.000Z");
  assert.ok(snapshot.tombstones.some((tombstone) => tombstone.reason === "corrected"));
});

test("an expired selection is refreshed as a new generation on the next rerun", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming"], T0, { expiresAt: "2026-10-01T10:30:00.000Z" }));
  const later = await lifecycle.applySelection(change(["gaming"], T1, { expiresAt: "2027-01-01T00:00:00.000Z" }));
  assert.ok(later.added.includes("canonical_interest:gaming"));
  assert.deepEqual(later.updated, []);
  const snapshot = await engine.readLedgerSnapshot({ subjectId: SUBJECT, now: T1 });
  assert.equal(snapshot.activeSignals.filter((entry) => entry.signal.target.kind === "canonical_interest" && entry.signal.target.key === "gaming").length, 1);
});

test("withdrawing on consent revocation retracts everything with the consent reason", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming", "technology"]));
  const result = await lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "consent_revoked", now: T1 });
  assert.equal(result.eventCount, result.removed.length);
  assert.ok(result.removed.length > 2);
  assert.deepEqual(activeKeys(await engine.readProfile(SUBJECT)), []);
  const snapshot = await engine.readLedgerSnapshot({ subjectId: SUBJECT, now: T1 });
  assert.equal(snapshot.activeSignals.length, 0);
  assert.ok(snapshot.tombstones.every((tombstone) => tombstone.reason === "consent_revoked"));
  const again = await lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "consent_revoked", now: T2 });
  assert.equal(again.eventCount, 0);
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "expired" as never }), TypeError);
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: undefined as never }), TypeError);
});

test("after consent is revoked a new selection is refused and nothing is written", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming"]));
  const historyBefore = (await engine.readEventHistory(SUBJECT)).length;
  const revoked: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: [], privateDataUses: [] };
  await assert.rejects(lifecycle.applySelection(change(["technology"], T1, { policy: revoked })), RecommendationConsentDeniedError);
  const otherSubject: RecommendationConsentPolicy = { subjectId: "someone-else", allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
  await assert.rejects(lifecycle.applySelection(change(["technology"], T1, { policy: otherSubject })), RecommendationConsentDeniedError);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, historyBefore);
});

test("a crash after the events were saved resumes without duplicating signals and finishes invalidation", async () => {
  const failures: RecommendationDerivedStateTarget[] = ["candidate_cache"];
  const { lifecycle, engine, calls, tasks } = harness({ failures });
  await assert.rejects(lifecycle.applySelection(change(["gaming"])), RecommendationDerivedStateInvalidationPendingError);
  const savedHistory = (await engine.readEventHistory(SUBJECT)).length;
  assert.ok(savedHistory > 0);
  assert.ok(tasks.has(SUBJECT));
  calls.length = 0;
  const retry = await lifecycle.applySelection(change(["gaming"]));
  assert.equal(retry.eventCount, 0);
  assert.equal(retry.processing.engine.ingestion.appliedCount, 0);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, savedHistory);
  assert.deepEqual(calls.map((call) => call.target), ["candidate_cache", "explanation_cache"]);
  assert.equal(tasks.size, 0);
});

test("concurrent changes for one subject are serialized and the last one wins deterministically", async () => {
  const { lifecycle, engine } = harness();
  const results = await Promise.all([
    lifecycle.applySelection(change(["gaming"], T0)),
    lifecycle.applySelection(change(["technology"], T1)),
    lifecycle.applySelection(change(["technology"], T2))
  ]);
  assert.equal(results[2]?.eventCount, 0);
  const keys = activeKeys(await engine.readProfile(SUBJECT));
  assert.ok(keys.includes("canonical_interest:technology") && !keys.includes("canonical_interest:gaming"));
  const ids = (await engine.readEventHistory(SUBJECT)).map((event) => event.operationId);
  assert.equal(new Set(ids).size, ids.length);
});

test("different subjects do not affect each other", async () => {
  const { lifecycle, engine } = harness();
  const other = "user-456";
  const otherPolicy: RecommendationConsentPolicy = { subjectId: other, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
  await lifecycle.applySelection(change(["gaming"]));
  await lifecycle.applySelection({ ...change(["technology"]), subjectId: other, policy: otherPolicy });
  await lifecycle.withdrawSelections({ subjectId: other, reason: "source_retracted", now: T1 });
  assert.ok(activeKeys(await engine.readProfile(SUBJECT)).includes("canonical_interest:gaming"));
  assert.deepEqual(activeKeys(await engine.readProfile(other)), []);
});

test("events that merely look like onboarding events are neither counted nor retracted", async () => {
  const { lifecycle, engine, derived } = harness();
  const seeded = await lifecycle.applySelection(change(["gaming"]));
  const template = (await engine.readLedgerSnapshot({ subjectId: SUBJECT, now: T0 })).activeSignals[0]!.signal;
  const foreign: RecommendationSignalLedgerEventInput[] = [
    { operation: "apply", operationId: "foreign-1", sourceEventId: "mastodon:status:1", occurredAt: T0, signal: template },
    // right shape, wrong hash for its own target
    { operation: "apply", operationId: "foreign-2", sourceEventId: `onboarding:v1:g0:${"a".repeat(64)}`, occurredAt: T0, signal: template },
    // not the exact shape
    { operation: "apply", operationId: "foreign-3", sourceEventId: "onboarding:v1:g0:short", occurredAt: T0, signal: template }
  ];
  await derived.process({ subjectId: SUBJECT, events: foreign, now: T0 });
  const result = await lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "source_retracted", now: T1 });
  assert.equal(result.removed.length, seeded.added.length);
  const retractedIds = (await engine.readEventHistory(SUBJECT)).filter((event) => event.operation === "retract").map((event) => event.operation === "retract" ? event.retractsSourceEventId : "");
  assert.ok(!retractedIds.some((id) => id === "mastodon:status:1" || id.includes("aaaa") || id.endsWith(":short")));
});

test("deleting the subject leaves a replay barrier that stops later onboarding writes", async () => {
  const { lifecycle, engine, derived } = harness();
  await lifecycle.applySelection(change(["gaming"]));
  await derived.deleteSubject({ subjectId: SUBJECT, requestedAt: T1, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
  await assert.rejects(lifecycle.applySelection(change(["gaming"], T2)), /deletion replay barrier/u);
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "source_retracted", now: T2 }), /deletion replay barrier/u);
  await assert.rejects(engine.readEventHistory(SUBJECT), /deletion replay barrier/u);
  assert.deepEqual(activeKeys(await engine.readProfile(SUBJECT)), []);
});

test("invalid inputs are rejected before any state is touched", async () => {
  const { lifecycle, engine } = harness();
  await assert.rejects(lifecycle.applySelection(null as never), TypeError);
  await assert.rejects(lifecycle.applySelection({ ...change(["gaming"]), subjectId: " x " }), TypeError);
  await assert.rejects(lifecycle.applySelection({ ...change(["gaming"]), subjectId: "a\u0000b" }), TypeError);
  await assert.rejects(lifecycle.applySelection({ ...change(["gaming"]), now: "tomorrow" }), TypeError);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, 0);
  assert.throws(() => createRecommendationOnboardingLifecycle({} as never), TypeError);
});

test("an edited or removed selection changes the profile fingerprint, so older scoring bindings are rejected", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming", "technology"]));
  const before = await engine.readProfile(SUBJECT);
  const staleFingerprint = createRecommendationEmbeddingSourceFingerprint(before);
  await lifecycle.applySelection(change(["technology"], T1));
  const after = await engine.readProfile(SUBJECT);
  assert.notEqual(createRecommendationEmbeddingSourceFingerprint(after).profileDigest, staleFingerprint.profileDigest);
  const item = candidate("did:plc:alice");
  await assert.rejects(
    buildColdStartScoringInput(
      { profile: after, candidates: [{ generated: { candidate: item, match: { candidateId: item.candidateId, sourceIds: ["s"], matchedCanonicalInterestIds: ["gaming"], matchedTags: [], matchedEntityIds: [], matchedLanguages: [], score: 1 } as never }, eligibility: { candidate: item, eligible: true, reasonCodes: ["eligible"], evaluatedAt: T0 }, profileFingerprint: staleFingerprint }] },
      {}
    ),
    /profile binding is stale/u
  );
});

function candidate(nativeId: string, interests: readonly string[] = ["gaming"]): RecommendationCandidate {
  const kind = "account" as const;
  const protocol = "atproto" as const;
  const provider = "bsky.app";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }), kind, protocol, nativeId, provider,
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: T0 }, availability: "available", observedAt: T0,
    metadata: { canonicalInterestIds: [...interests], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "test-source", observedAt: T0, trustBoundary: "same_provider" }]
  };
}
function source(items: readonly RecommendationCandidate[]): RecommendationCandidateSourceAdapter {
  return {
    id: "test-source", protocols: ["atproto"], candidateKinds: ["account"], authority: "provider_native", transport: "local",
    privacy: { sourceVisibility: "public", accessBasis: "atproto_public_repo", containsPrivateData: false, containsThirdPartyData: false, serverSideProcessing: false, providerPolicyAllowsProcessing: true },
    capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"],
    read: () => ({ candidates: items })
  };
}
const REQUEST = { subjectId: SUBJECT, requestId: "refresh-1", languages: ["en"], limit: 10 } as const;

test("refresh reruns the first session after selections are edited and honors reported candidate facts", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const { lifecycle, calls } = harness({ firstSessionSources: [source([alice, bob])] });
  await lifecycle.applySelection(change(["gaming"]));

  const first = await lifecycle.refresh({ request: REQUEST, now: T1 });
  assert.deepEqual(first.result.recommendations.map((item) => item.candidate.candidateId).sort(), [alice.candidateId, bob.candidateId].sort());
  const repeat = await lifecycle.refresh({ request: { ...REQUEST, requestId: "refresh-2" }, now: T1 });
  assert.deepEqual(repeat.result.recommendations.map((item) => item.candidate.candidateId), first.result.recommendations.map((item) => item.candidate.candidateId));

  calls.length = 0;
  const moved = await lifecycle.refresh({
    request: { ...REQUEST, requestId: "refresh-3", excludeCandidateIds: ["zzz"] },
    candidateEvents: [{ kind: "account_moved", occurredAt: T1, candidateId: alice.candidateId }],
    now: T2
  });
  assert.deepEqual(moved.excludedCandidateIds, [alice.candidateId, "zzz"].sort());
  assert.deepEqual(moved.result.recommendations.map((item) => item.candidate.candidateId), [bob.candidateId]);
  assert.deepEqual(calls.map((call) => call.target), ["candidate_cache", "explanation_cache"]);

  await lifecycle.applySelection(change(["technology"], T2));
  const edited = await lifecycle.refresh({ request: { ...REQUEST, requestId: "refresh-4" }, now: T2 });
  assert.deepEqual(edited.result.recommendations, []);
  await lifecycle.applySelection(change(["gaming"], T2));
  const restored = await lifecycle.refresh({ request: { ...REQUEST, requestId: "refresh-5" }, now: T2 });
  assert.equal(restored.result.recommendations.length, 2);
});

test("refresh does not rerun when pending invalidation cannot be finished", async () => {
  const failures: RecommendationDerivedStateTarget[] = ["candidate_cache"];
  const { lifecycle, firstSessionCalls } = harness({ failures, firstSessionSources: [source([candidate("did:plc:alice")])] });
  await assert.rejects(lifecycle.applySelection(change(["gaming"])), RecommendationDerivedStateInvalidationPendingError);
  failures.push("explanation_cache");
  await assert.rejects(lifecycle.refresh({ request: REQUEST, now: T1 }), RecommendationDerivedStateInvalidationPendingError);
  assert.equal(firstSessionCalls.length, 0);
  const healed = await lifecycle.refresh({ request: REQUEST, now: T1 });
  assert.equal(healed.result.recommendations.length, 1);
});

test("refresh requires a first-session orchestrator and valid events", async () => {
  const bare = harness();
  await assert.rejects(bare.lifecycle.refresh({ request: REQUEST }), /first-session orchestrator/u);
  const full = harness({ firstSessionSources: [source([])] });
  await assert.rejects(full.lifecycle.refresh({ request: REQUEST, candidateEvents: [{ kind: "nonsense" } as never], now: T1 }), TypeError);
  await assert.rejects(full.lifecycle.refresh({ request: { ...REQUEST, subjectId: "" }, now: T1 }), TypeError);
  assert.equal(full.calls.length, 0);
});

test("reporting candidate events clears candidate caches durably and rejects bad events without side effects", async () => {
  const { lifecycle, calls, tasks } = harness();
  await lifecycle.applySelection(change(["gaming"]));
  calls.length = 0;
  const none = await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [], now: T1 });
  assert.equal(none.acceptedEventCount, 0);
  assert.equal(none.propagation, undefined);
  assert.equal(calls.length, 0);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [{ kind: "set_deleted", occurredAt: T1 } as never], now: T1 }), TypeError);
  assert.equal(calls.length, 0);
  const ok = await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [{ kind: "set_deleted", occurredAt: T1, setSourceId: "curated-set:v1:x", candidateId: "pack-1" }, { kind: "set_deleted", occurredAt: T1, setSourceId: "curated-set:v1:x", candidateId: "pack-1" }], now: T1 });
  assert.equal(ok.acceptedEventCount, 1);
  assert.deepEqual(ok.excludedCandidateIds, ["pack-1"]);
  assert.deepEqual(calls.map((call) => call.target), ["candidate_cache", "explanation_cache"]);
  assert.equal(tasks.size, 0);
});

const SKEW_MS = 5 * 60 * 1000;
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

test("a far-future time is rejected and does not write a second set of signals over live ones", async () => {
  const { lifecycle, engine } = harness();
  const first = await lifecycle.applySelection(change(["gaming", "technology"], T0, { expiresAt: "2026-10-02T10:00:00.000Z" }));
  assert.ok(first.eventCount > 0);
  const before = (await engine.readEventHistory(SUBJECT)).length;
  await assert.rejects(lifecycle.applySelection(change(["gaming", "technology"], T0, { now: FAR_FUTURE, expiresAt: "2026-10-02T10:00:00.000Z" })), RangeError);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, before);
  // With a sane clock the same call is still a no-op, so the first set is the only live one.
  const repeat = await lifecycle.applySelection(change(["gaming", "technology"], T0, { now: T2, expiresAt: "2026-10-02T10:00:00.000Z" }));
  assert.equal(repeat.eventCount, 0);
});

test("a time exactly at the skew limit is accepted and one millisecond past it is rejected", async () => {
  const { lifecycle } = harness({ firstSessionSources: [source([])] });
  const limit = new Date(Date.parse(T2) + SKEW_MS).toISOString();
  const past = new Date(Date.parse(T2) + SKEW_MS + 1).toISOString();
  const ok = await lifecycle.applySelection(change(["gaming"], T0, { now: limit }));
  assert.ok(ok.eventCount > 0);
  await assert.rejects(lifecycle.applySelection(change(["gaming"], T0, { now: past })), RangeError);
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "source_retracted", now: past }), RangeError);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [], now: past }), RangeError);
  await assert.rejects(lifecycle.refresh({ request: REQUEST, now: past }), RangeError);
});

test("withdrawing with a far-future time leaves the live signals alone", async () => {
  const { lifecycle, engine } = harness();
  await lifecycle.applySelection(change(["gaming"]));
  const before = (await engine.readEventHistory(SUBJECT)).length;
  await assert.rejects(lifecycle.withdrawSelections({ subjectId: SUBJECT, reason: "consent_revoked", now: FAR_FUTURE }), RangeError);
  assert.equal((await engine.readEventHistory(SUBJECT)).length, before);
});

test("an omitted time falls back to the lifecycle clock", async () => {
  const { lifecycle, engine } = harness();
  const { now: _unused, ...withoutNow } = change(["gaming"]);
  await lifecycle.applySelection(withoutNow);
  const history = await engine.readEventHistory(SUBJECT);
  assert.ok(history.length > 0);
});

function curatedSet(id: string, members: readonly string[]): RecommendationCuratedAccountSet {
  return {
    provider: "mastodon_collection", id, url: `https://social.example/collections/${id}`, curatorId: "curator-1", name: `Set ${id}`,
    discoverable: true, sensitive: false, observedAt: T0, hashtags: ["gaming"], trustBoundary: "same_provider", membershipComplete: true,
    members: members.map((name) => ({ accountId: `acct-${name}`, accountUri: `https://social.example/users/${name}`, handle: `${name}@social.example`, state: "accepted" as const }))
  };
}
const CURATED_KINDS: readonly RecommendationCandidateKind[] = ["account", "starter_pack"];
const SET_A = createRecommendationCuratedAccountSetSourceId("mastodon_collection", "set-a");
const SET_B = createRecommendationCuratedAccountSetSourceId("mastodon_collection", "set-b");

async function curatedRefresh(events: Parameters<RecommendationOnboardingLifecycle["refresh"]>[0]["candidateEvents"], sets = [curatedSet("set-a", ["alice", "bob"]), curatedSet("set-b", ["carol"])]) {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets });
  const h = harness({ firstSessionSources: [adapter], candidateKinds: CURATED_KINDS });
  await h.lifecycle.applySelection(change(["gaming"]));
  const run = await h.lifecycle.refresh({ request: { ...REQUEST, limit: 50 }, ...(events === undefined ? {} : { candidateEvents: events }), now: T1 });
  return run;
}
const natives = (run: Awaited<ReturnType<typeof curatedRefresh>>) => run.result.recommendations.map((item) => item.candidate.nativeId).sort();

test("a set-level event with no candidate ID drops that set's members and starter pack on refresh, and nothing else", async () => {
  const baseline = natives(await curatedRefresh(undefined));
  assert.deepEqual(baseline, [
    "https://social.example/collections/set-a", "https://social.example/collections/set-b",
    "https://social.example/users/alice", "https://social.example/users/bob", "https://social.example/users/carol"
  ]);
  for (const kind of ["set_deleted", "set_not_discoverable", "set_sensitive"] as const) {
    const run = await curatedRefresh([{ kind, occurredAt: T1, setSourceId: SET_A }]);
    assert.deepEqual(natives(run), ["https://social.example/collections/set-b", "https://social.example/users/carol"], kind);
    assert.deepEqual(run.excludedSetSourceIds, [SET_A]);
    assert.deepEqual(run.excludedCandidateIds, []);
  }
});

test("a member in two sets is dropped when either set is reported, and an unknown set source ID changes nothing", async () => {
  const sets = [curatedSet("set-a", ["alice", "bob"]), curatedSet("set-b", ["bob"])];
  const dropped = await curatedRefresh([{ kind: "set_deleted", occurredAt: T1, setSourceId: SET_B }], sets);
  assert.ok(!natives(dropped).includes("https://social.example/users/bob"));
  assert.ok(natives(dropped).includes("https://social.example/users/alice"));
  const unknown = await curatedRefresh([{ kind: "set_deleted", occurredAt: T1, setSourceId: "curated-set:v1:nope" }]);
  assert.equal(natives(unknown).length, 5);
});

test("member consent events only exclude the named candidate, not the whole set", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets: [curatedSet("set-a", ["alice", "bob"])] });
  const h = harness({ firstSessionSources: [adapter], candidateKinds: CURATED_KINDS });
  await h.lifecycle.applySelection(change(["gaming"]));
  const before = await h.lifecycle.refresh({ request: { ...REQUEST, limit: 50 }, now: T1 });
  const aliceId = before.result.recommendations.find((item) => item.candidate.nativeId.endsWith("/alice"))!.candidate.candidateId;
  const run = await h.lifecycle.refresh({
    request: { ...REQUEST, requestId: "refresh-2", limit: 50 },
    candidateEvents: [{ kind: "member_consent_revoked", occurredAt: T1, candidateId: aliceId, setSourceId: SET_A }],
    now: T1
  });
  assert.deepEqual(run.excludedSetSourceIds, []);
  assert.deepEqual(run.result.recommendations.map((item) => item.candidate.nativeId).sort(), [
    "https://social.example/collections/set-a", "https://social.example/users/bob"
  ]);
});

test("set exclusions apply to the one refresh that reports them and merge with caller exclusions", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets: [curatedSet("set-a", ["alice"]), curatedSet("set-b", ["carol"])] });
  const h = harness({ firstSessionSources: [adapter], candidateKinds: CURATED_KINDS });
  await h.lifecycle.applySelection(change(["gaming"]));
  const run = await h.lifecycle.refresh({
    request: { ...REQUEST, limit: 50, excludeSourceIds: [SET_B] },
    candidateEvents: [{ kind: "set_deleted", occurredAt: T1, setSourceId: SET_A }],
    now: T1
  });
  assert.deepEqual(run.excludedSetSourceIds, [SET_A, SET_B].sort());
  assert.deepEqual(run.result.recommendations, []);
  const later = await h.lifecycle.refresh({ request: { ...REQUEST, requestId: "refresh-2", limit: 50 }, now: T1 });
  assert.equal(later.result.recommendations.length, 4);
});

test("excluded sets do not take candidate slots from usable ones", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "curated.sets", sets: [curatedSet("set-a", ["alice", "bob", "carol"]), curatedSet("set-b", ["dave"])] });
  const h = harness({ firstSessionSources: [adapter], candidateKinds: ["account"] });
  await h.lifecycle.applySelection(change(["gaming"]));
  const run = await h.lifecycle.refresh({
    request: { ...REQUEST, limit: 50 },
    candidateEvents: [{ kind: "set_deleted", occurredAt: T1, setSourceId: SET_A }],
    now: T1
  });
  assert.equal(run.result.discoveredCandidateCount, 1);
  assert.deepEqual(run.result.recommendations.map((item) => item.candidate.nativeId), ["https://social.example/users/dave"]);
});

type Harness = ReturnType<typeof harness>;

/** A read-only view of the harness engine that reports every history read before returning it. */
function spyEngine(h: Harness, onRead: (history: Awaited<ReturnType<Harness["engine"]["readEventHistory"]>>) => Promise<void> | void) {
  return {
    async readEventHistory(id: string) {
      const history = await h.engine.readEventHistory(id);
      await onRead(history);
      return history;
    }
  };
}

test("lifecycle instances on one engine queue behind each other for the same subject", async () => {
  const h = harness();
  const trace: string[] = [];
  const engine = spyEngine(h, async () => { trace.push("read"); await new Promise((resolve) => setImmediate(resolve)); });
  const derived = { ...h.derived, process: ((input: Parameters<Harness["derived"]["process"]>[0]) => { trace.push("write"); return h.derived.process(input); }) as Harness["derived"]["process"] };
  const a = createRecommendationOnboardingLifecycle({ derived, engine, now: () => lifecycleClock });
  const b = createRecommendationOnboardingLifecycle({ derived, engine, now: () => lifecycleClock });
  await Promise.all([a.applySelection(change(["gaming"], T0)), b.applySelection(change(["music"], T1))]);
  assert.deepEqual(trace.slice(0, 4), ["read", "write", "read", "write"], "the second plan waits for the first write");
});

/** A lifecycle whose first history read is followed by a write from outside the lifecycle queue. */
function lifecycleWithRival(h: Harness, rival: () => Promise<unknown>): RecommendationOnboardingLifecycleWithCandidateEvents {
  let armed = true;
  const engine = spyEngine(h, async () => { if (armed) { armed = false; await rival(); } });
  return createRecommendationOnboardingLifecycle({ derived: h.derived, engine, now: () => lifecycleClock });
}

async function rivalEventsFor(topics: readonly string[]) {
  const probe = harness();
  await probe.lifecycle.applySelection(change(topics, T0));
  return probe.engine.readEventHistory(SUBJECT);
}

test("a direct write racing applySelection with the same target at another time converges", async () => {
  const rivalEvents = await rivalEventsFor(["gaming"]);
  const h = harness();
  const lifecycle = lifecycleWithRival(h, () => h.derived.process({ subjectId: SUBJECT, events: rivalEvents, now: T0 }));
  const result = await lifecycle.applySelection(change(["gaming"], T1));
  assert.ok(activeKeys(await h.engine.readProfile(SUBJECT)).includes("canonical_interest:gaming"));
  assert.equal(result.eventCount, 0, "the replan sees the rival's signal and has nothing left to write");
  const ids = (await h.engine.readEventHistory(SUBJECT)).map((event) => event.sourceEventId);
  assert.equal(new Set(ids).size, ids.length);
});

test("a ledger error that is not caused by a moved history is not retried", async () => {
  const h = harness();
  let writes = 0;
  const derived = { ...h.derived, process: async () => { writes += 1; throw new TypeError("not a race"); } };
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine: h.engine, now: () => lifecycleClock });
  await assert.rejects(lifecycle.applySelection(change(["gaming"], T0)), /not a race/u);
  assert.equal(writes, 1);
});

const REPORTED = { kind: "account_deleted" as const, occurredAt: T1, accountUri: "https://example.test/users/alice" };

test("reported events are marked unverified when no verifier is configured", async () => {
  const h = harness();
  const result = await h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 });
  assert.equal(result.evidenceVerification, "unverified");
  assert.equal(result.verifierId, undefined);
  assert.equal(result.acceptedEventCount, 1);
});

test("a verifier that accepts marks the report verified and sees the subject, kind and time", async () => {
  const seen: unknown[] = [];
  const h = harness({ evidenceVerifier: { verifier: { id: "test-keys", verify: (evidence, context) => { seen.push([evidence, context.subjectId, context.kind, context.now]); return { verified: true }; } } } });
  const result = await h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 });
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "test-keys");
  assert.deepEqual(seen, [[REPORTED, SUBJECT, "lifecycle_event", T1]]);
});

test("a rejected, thrown, malformed or slow verification stops the report before any cache is cleared", async () => {
  const cases: [string, () => unknown, string][] = [
    ["rejected", () => ({ verified: false }), "rejected"],
    ["throws", () => { throw new Error("boom"); }, "error"],
    ["async throw", async () => { throw new Error("boom"); }, "error"],
    ["truthy but not boolean", () => ({ verified: "yes" }), "malformed"],
    ["bare true", () => true, "malformed"],
    ["nothing", () => undefined, "malformed"],
    ["never answers", () => new Promise(() => undefined), "timeout"]
  ];
  for (const [name, verify, failure] of cases) {
    const h = harness({ evidenceVerifier: { verifier: { id: "test-keys", verify: verify as never }, timeoutMs: 20 } });
    await assert.rejects(h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 }), (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === failure, name);
    assert.equal(h.calls.length, 0, name);
  }
});

test("the timeout aborts the signal handed to the verifier", async () => {
  let aborted = false;
  const h = harness({ evidenceVerifier: { verifier: { id: "slow", verify: (_e, context) => new Promise(() => { context.signal.addEventListener("abort", () => { aborted = true; }); }) }, timeoutMs: 10 } });
  await assert.rejects(h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 }), RecommendationEvidenceVerificationError);
  assert.equal(aborted, true);
});

test("a verifier bound to a subject refuses evidence replayed for another subject, and a replayed nonce", async () => {
  const issued = new Map<string, string>([["alice-event", SUBJECT]]);
  const used = new Set<string>();
  // Stand-in for a signature check: the proof table says which subject each event was issued for.
  const verifier = { id: "bound", verify: (evidence: unknown, context: { subjectId: string }) => {
    const id = (evidence as { accountUri: string }).accountUri.endsWith("alice") ? "alice-event" : "unknown";
    if (issued.get(id) !== context.subjectId) return { verified: false };
    const key = `${context.subjectId}:${id}`;
    if (used.has(key)) return { verified: false };
    used.add(key);
    return { verified: true };
  } };
  const h = harness({ evidenceVerifier: { verifier } });
  assert.equal((await h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 })).evidenceVerification, "verified");
  await assert.rejects(h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REPORTED], now: T1 }), RecommendationEvidenceVerificationError);
  await assert.rejects(h.lifecycle.reportCandidateEvents({ subjectId: "user-456", events: [REPORTED], now: T1 }), RecommendationEvidenceVerificationError);
  await assert.rejects(h.lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [{ ...REPORTED, accountUri: "https://example.test/users/mallory" }], now: T1 }), RecommendationEvidenceVerificationError);
});

test("an invalid verifier configuration is refused when the lifecycle is created", () => {
  for (const bad of [{ verifier: { id: "", verify: () => ({ verified: true }) } }, { verifier: { id: "x" } }, { verifier: { id: "x", verify: () => ({ verified: true }) }, timeoutMs: 0 }, { verifier: { id: "x", verify: () => ({ verified: true }) }, timeoutMs: 31_000 }, null]) {
    assert.throws(() => harness({ evidenceVerifier: bad as never }), TypeError);
  }
});
