import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as api from "../src/index.js";
import type {
  RecommendationCandidateEventRecord,
  RecommendationCandidatePlanAssessment,
  RecommendationCandidatePlanAssessmentWithEvidence,
  RecommendationCandidateEventStore,
  RecommendationCandidateStateInvalidator,
  RecommendationDerivedStateInvalidationOrchestrator,
  RecommendationEngineEventHistoryReader,
  RecommendationEngineOrchestrator,
  RecommendationEvidenceVerifier,
  RecommendationOnboardingCandidateReportResult,
  RecommendationOnboardingCandidateReportResultWithEvidence,
  RecommendationOnboardingLifecycle,
  RecommendationOnboardingLifecycleOptions,
  RecommendationOnboardingLifecycleWithCandidateEvents,
  RecommendationOnboardingRefreshResult,
  RecommendationOnboardingRefreshResultWithSetExclusions
} from "../src/index.js";

// Compile-time half. If a member is added to or removed from one of these interfaces, `pnpm lint:types`
// and `pnpm build` fail here until the literal list is updated on purpose. That is the point: the
// change then shows up in review. Interface members do not exist at runtime, so a JSON snapshot
// cannot cover them.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type _EngineKeys = Assert<Equal<keyof RecommendationEngineOrchestrator,
  "process" | "synchronize" | "readProfile" | "readLedgerSnapshot" | "deleteSubject">>;
type _EngineHistoryKeys = Assert<Equal<keyof RecommendationEngineEventHistoryReader, "readEventHistory">>;
type _DerivedKeys = Assert<Equal<keyof RecommendationDerivedStateInvalidationOrchestrator,
  "process" | "synchronize" | "repair" | "deleteSubject">>;
type _CandidateInvalidatorKeys = Assert<Equal<keyof RecommendationCandidateStateInvalidator, "invalidateCandidateState">>;
// The base lifecycle keeps its 0.2.0 members. New ones live on the extending interface.
type _LifecycleKeys = Assert<Equal<keyof RecommendationOnboardingLifecycle,
  "applySelection" | "withdrawSelections" | "reportCandidateEvents" | "refresh">>;
type _LifecycleWithCandidateEventsKeys = Assert<Equal<keyof RecommendationOnboardingLifecycleWithCandidateEvents,
  "applySelection" | "withdrawSelections" | "reportCandidateEvents" | "listReportedCandidateEvents" | "assessPlan" | "refresh">>;
type _LifecycleOptionKeys = Assert<Equal<keyof RecommendationOnboardingLifecycleOptions,
  "derived" | "engine" | "firstSession" | "now" | "evidenceVerifier" | "candidateEvents" | "subjectLock">>;
type _SubjectLockKeys = Assert<Equal<keyof api.RecommendationSubjectLockOptions, "acquire" | "timeoutMs" | "signal" | "onReleaseError" | "maxHoldMs" | "onHoldExceeded">>;
type _SubjectLockReasons = Assert<Equal<api.RecommendationSubjectLockFailureReason,
  "acquire_failed" | "acquire_timeout" | "aborted" | "hold_exceeded" | "invalid_release" | "release_failed" | "release_timeout">>;
type _EventStoreKeys = Assert<Equal<keyof RecommendationCandidateEventStore,
  "manifest" | "supportsCompareAndSet" | "load" | "save" | "delete">>;
type _VerifierKeys = Assert<Equal<keyof RecommendationEvidenceVerifier, "id" | "verify">>;
type _VerificationStates = Assert<Equal<api.RecommendationEvidenceVerificationState, "verified" | "partial" | "unverified">>;
type _PlanAssessmentKeys = Assert<Equal<keyof RecommendationCandidatePlanAssessment,
  "schemaVersion" | "state" | "usable" | "executable" | "requiresRevalidation" | "assessedAt" |
  "reasons" | "affectedMemberCandidateIds" | "unaffectedMemberCandidateIds">>;
type _PlanAssessmentWithEvidenceKeys = Assert<Equal<keyof RecommendationCandidatePlanAssessmentWithEvidence,
  keyof RecommendationCandidatePlanAssessment | "evidenceVerification" | "verifierId" | "verifiedKinds" | "storedEventsNotChecked">>;
type _ReportResultKeys = Assert<Equal<keyof RecommendationOnboardingCandidateReportResult,
  "subjectId" | "acceptedEventCount" | "excludedCandidateIds" | "propagation">>;
type _ReportResultWithEvidenceKeys = Assert<Equal<keyof RecommendationOnboardingCandidateReportResultWithEvidence,
  keyof RecommendationOnboardingCandidateReportResult | "evidenceVerification" | "verifierId" | "verifiedKinds" | "storedEventsNotChecked">>;
type _RefreshResultKeys = Assert<Equal<keyof RecommendationOnboardingRefreshResult,
  "result" | "excludedCandidateIds" | "propagation">>;
type _RefreshResultWithSetExclusionsKeys = Assert<Equal<keyof RecommendationOnboardingRefreshResultWithSetExclusions,
  keyof RecommendationOnboardingRefreshResult | "excludedSetSourceIds" | "evidenceVerification" | "verifierId" | "verifiedKinds" | "storedEventsNotChecked">>;
// The extended types must stay assignable to the base types, or the factories would break old consumers.
type _LifecycleExtends = Assert<RecommendationOnboardingLifecycleWithCandidateEvents extends RecommendationOnboardingLifecycle ? true : false>;
type _AssessmentExtends = Assert<RecommendationCandidatePlanAssessmentWithEvidence extends RecommendationCandidatePlanAssessment ? true : false>;
type _ReportExtends = Assert<RecommendationOnboardingCandidateReportResultWithEvidence extends RecommendationOnboardingCandidateReportResult ? true : false>;
type _RefreshExtends = Assert<RecommendationOnboardingRefreshResultWithSetExclusions extends RecommendationOnboardingRefreshResult ? true : false>;
type _EventRecordKeys = Assert<Equal<keyof RecommendationCandidateEventRecord,
  "schemaVersion" | "subjectId" | "updatedAt" | "entries" | "digest">>;

// An app's own engine or derived-state double must keep compiling without the extension members.
const handWrittenEngine: RecommendationEngineOrchestrator = {
  process: async () => { throw new Error("unused"); },
  synchronize: async () => { throw new Error("unused"); },
  readProfile: async () => { throw new Error("unused"); },
  readLedgerSnapshot: async () => { throw new Error("unused"); },
  deleteSubject: async () => { throw new Error("unused"); }
};
const handWrittenDerived: RecommendationDerivedStateInvalidationOrchestrator = {
  process: async () => { throw new Error("unused"); },
  synchronize: async () => { throw new Error("unused"); },
  repair: async () => { throw new Error("unused"); },
  deleteSubject: async () => { throw new Error("unused"); }
};
const lifecycleOptionsWithoutExtensions: RecommendationOnboardingLifecycleOptions = {
  derived: handWrittenDerived,
  engine: handWrittenEngine
};
void lifecycleOptionsWithoutExtensions;

// A lifecycle double and result values written against the 0.2.0 shapes must keep compiling.
const handWrittenLifecycle: RecommendationOnboardingLifecycle = {
  applySelection: async () => { throw new Error("unused"); },
  withdrawSelections: async () => { throw new Error("unused"); },
  reportCandidateEvents: async ({ subjectId }) => ({ subjectId, acceptedEventCount: 0, excludedCandidateIds: [], propagation: undefined }),
  refresh: async () => { throw new Error("unused"); }
};
const handBuiltReport: RecommendationOnboardingCandidateReportResult = {
  subjectId: "subject-1", acceptedEventCount: 0, excludedCandidateIds: [], propagation: undefined
};
const handBuiltAssessment: RecommendationCandidatePlanAssessment = {
  schemaVersion: "recommendation-candidate-plan-assessment.v1",
  state: "valid", usable: true, executable: false, requiresRevalidation: true,
  assessedAt: "2026-01-01T00:00:00.000Z", reasons: [], affectedMemberCandidateIds: [], unaffectedMemberCandidateIds: []
};
void handWrittenLifecycle; void handBuiltReport; void handBuiltAssessment;

// Runtime half. Exported names and every exported ALL_CAPS list (reasons, domains, capabilities...) are
// compared with a checked-in fixture. To accept an intentional change:
//   pnpm build && UPDATE_API_SURFACE=1 node --test dist/tests/public-api-surface.test.js
// then review the fixture diff and commit it together with the change.
const FIXTURE_URL = new URL("../../tests/fixtures/public-api-surface.json", import.meta.url);

function currentSurface(): { exports: string[]; lists: Record<string, unknown[]> } {
  const names = Object.keys(api).sort();
  const lists: Record<string, unknown[]> = {};
  for (const name of names) {
    const value = (api as Record<string, unknown>)[name];
    if (/^[A-Z][A-Z0-9_]+$/u.test(name) && Array.isArray(value)) lists[name] = [...value];
  }
  return { exports: names, lists };
}

// The update switch skips the comparison, so it must never be able to pass quietly in CI.
function assertUpdateAllowed(env: Record<string, string | undefined>): void {
  // Any non-empty value counts, "false" and "0" included: a CI system that sets CI=false is still a CI system.
  if (env.CI !== undefined && env.CI !== "") {
    throw new Error("UPDATE_API_SURFACE cannot be used when CI is set.");
  }
}

test("public API surface matches the checked-in snapshot", () => {
  const actual = currentSurface();
  if (process.env.UPDATE_API_SURFACE === "1") {
    assertUpdateAllowed(process.env);
    writeFileSync(FIXTURE_URL, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as typeof actual;
  const added = actual.exports.filter((name) => !expected.exports.includes(name));
  const removed = expected.exports.filter((name) => !actual.exports.includes(name));
  assert.deepEqual({ added, removed }, { added: [], removed: [] },
    "Exports changed. If this is intended, regenerate tests/fixtures/public-api-surface.json (see the comment in this test).");
  assert.deepEqual(actual.lists, expected.lists,
    "An exported list (reasons, domains, kinds, capabilities...) changed. Lists are open unions, so check consumers need a default case, then regenerate the fixture.");
});

test("the snapshot covers the Phase 7 additions and the extension seams", () => {
  const { exports, lists } = currentSurface();
  for (const name of [
    "createRecommendationOnboardingLifecycle",
    "createRecommendationEngineOrchestrator",
    "createRecommendationDerivedStateInvalidationOrchestrator",
    "createInMemoryRecommendationCandidateEventStore",
    "RECOMMENDATION_CANDIDATE_EVENT_RECORD_SCHEMA_VERSION"
  ]) assert.ok(exports.includes(name), `${name} should be exported`);
  assert.ok(lists.RECOMMENDATION_STATE_DOMAINS?.includes("candidate_lifecycle_events"));
  assert.ok(lists.RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS?.includes("candidate_state_changed"));
});

test("the update switch is refused whenever CI is set to anything, and allowed locally", () => {
  for (const value of ["true", "1", "false", "0"]) {
    assert.throws(() => assertUpdateAllowed({ CI: value }), /CI is set/u, `CI=${value}`);
  }
  assert.doesNotThrow(() => assertUpdateAllowed({}));
  assert.doesNotThrow(() => assertUpdateAllowed({ CI: undefined }));
  assert.doesNotThrow(() => assertUpdateAllowed({ CI: "" }));
});

test("the library lifecycle works through the 0.2.0 interface and still returns the richer results", async () => {
  const lifecycle = api.createRecommendationOnboardingLifecycle({
    derived: handWrittenDerived,
    engine: handWrittenEngine,
    now: () => "2026-01-01T00:00:00.000Z"
  });
  const asOldInterface: RecommendationOnboardingLifecycle = lifecycle;
  const oldResult: RecommendationOnboardingCandidateReportResult = await asOldInterface.reportCandidateEvents({ subjectId: "subject-1", events: [] });
  assert.equal(oldResult.acceptedEventCount, 0);
  // The same object still carries the evidence fields for callers that ask for the richer type.
  const richer = await lifecycle.reportCandidateEvents({ subjectId: "subject-1", events: [] });
  assert.equal(richer.evidenceVerification, "unverified");
  assert.deepEqual(richer.verifiedKinds, []);
  assert.equal(richer.storedEventsNotChecked, 0);
});
