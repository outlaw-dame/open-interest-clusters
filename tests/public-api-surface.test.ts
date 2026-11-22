import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as api from "../src/index.js";
import type {
  RecommendationCandidateEventRecord,
  RecommendationCandidatePlanAssessment,
  RecommendationCandidateEventStore,
  RecommendationCandidateStateInvalidator,
  RecommendationDerivedStateInvalidationOrchestrator,
  RecommendationEngineEventHistoryReader,
  RecommendationEngineOrchestrator,
  RecommendationEvidenceVerifier,
  RecommendationOnboardingLifecycle,
  RecommendationOnboardingLifecycleOptions
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
type _LifecycleKeys = Assert<Equal<keyof RecommendationOnboardingLifecycle,
  "applySelection" | "withdrawSelections" | "reportCandidateEvents" | "listReportedCandidateEvents" | "assessPlan" | "refresh">>;
type _LifecycleOptionKeys = Assert<Equal<keyof RecommendationOnboardingLifecycleOptions,
  "derived" | "engine" | "firstSession" | "now" | "evidenceVerifier" | "candidateEvents">>;
type _EventStoreKeys = Assert<Equal<keyof RecommendationCandidateEventStore,
  "manifest" | "supportsCompareAndSet" | "load" | "save" | "delete">>;
type _VerifierKeys = Assert<Equal<keyof RecommendationEvidenceVerifier, "id" | "verify">>;
type _VerificationStates = Assert<Equal<api.RecommendationEvidenceVerificationState, "verified" | "partial" | "unverified">>;
type _PlanAssessmentKeys = Assert<Equal<keyof RecommendationCandidatePlanAssessment,
  "schemaVersion" | "state" | "usable" | "executable" | "requiresRevalidation" | "assessedAt" | "evidenceVerification" |
  "verifierId" | "verifiedKinds" | "storedEventsNotChecked" | "reasons" | "affectedMemberCandidateIds" | "unaffectedMemberCandidateIds">>;
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
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "false" && env.CI !== "0") {
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

test("the update switch is refused in CI and allowed locally", () => {
  assert.throws(() => assertUpdateAllowed({ CI: "true" }), /CI is set/u);
  assert.throws(() => assertUpdateAllowed({ CI: "1" }), /CI is set/u);
  assert.doesNotThrow(() => assertUpdateAllowed({}));
  assert.doesNotThrow(() => assertUpdateAllowed({ CI: "false" }));
});
