import test from "node:test";
import assert from "node:assert/strict";
import { RECOMMENDATION_GLOBAL_CATALOG_V1, createRecommendationCatalogIndex, createRecommendationOnboardingSelection, type RecommendationFirstSessionResult } from "../src/index.js";
import { createFakeAccountCandidate } from "../examples/fakes.js";
import { describeCandidateEvidence, describeEventEvidence, describePlan, describeSessionState, explainRecommendation, PLAN_BLOCKED_COPY, REASON_COPY, SESSION_STATE_COPY } from "../examples/view-models.js";
import { T0, setup } from "./phase8-reference-fixtures.js";

const CATALOG = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
const selection = createRecommendationOnboardingSelection({ catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming"], selectedCanonicalTagIds: [], allowAutoFollowHashtags: false, selectedAt: T0, storageTarget: "local_app" });

function result(overrides: Partial<RecommendationFirstSessionResult>): RecommendationFirstSessionResult {
  return { requestId: "r", subjectId: "s", profileUpdatedAt: T0, profileSignalCount: 3, discoveredCandidateCount: 2, eligibleCandidateCount: 2, eligibilityFailureCount: 0, sourceFailures: [], recommendations: [], ...overrides };
}
const oneRecommendation = [{ candidate: createFakeAccountCandidate("dana", T0, ["gaming"]), score: 0.5, rank: 1, components: [] as never }];

test("every empty and partial state in the design table maps to its own copy", () => {
  const cases: [Partial<RecommendationFirstSessionResult>, keyof typeof SESSION_STATE_COPY][] = [
    [{ profileSignalCount: 0 }, "no_picks"],
    [{ discoveredCandidateCount: 0, eligibleCandidateCount: 0 }, "nothing_found"],
    [{ eligibleCandidateCount: 0 }, "none_eligible"],
    [{ sourceFailures: [{ sourceId: "a", code: "source_read_failed" }], recommendations: oneRecommendation }, "partial"],
    [{ eligibilityFailureCount: 1, recommendations: oneRecommendation }, "partial"],
    [{ sourceFailures: [{ sourceId: "a", code: "source_read_failed" }], discoveredCandidateCount: 0, eligibleCandidateCount: 0 }, "all_failed"],
    [{ recommendations: oneRecommendation }, "ready"]
  ];
  for (const [overrides, expected] of cases) {
    const view = describeSessionState(result(overrides));
    assert.equal(view.state, expected);
    assert.equal(view.text, SESSION_STATE_COPY[expected]);
  }
  // Empty picks win over everything else, so a withdrawal shows the empty state and not an error.
  assert.equal(describeSessionState(result({ profileSignalCount: 0, sourceFailures: [{ sourceId: "a", code: "source_read_failed" }] })).state, "no_picks");
});

test("a reason is only as specific as the facts: no pick match and no curator gives the generic line", () => {
  const stranger = createFakeAccountCandidate("zed", T0, ["cooking"]);
  const reason = explainRecommendation({ candidate: stranger }, selection, CATALOG);
  assert.equal(reason.copyKey, "generic");
  assert.equal(reason.text, REASON_COPY.generic);
  assert.deepEqual(reason.values, {});
});

test("a curator is named when there is no matching pick", () => {
  const base = createFakeAccountCandidate("zed", T0, ["cooking"]);
  const candidate = { ...base, provenance: [{ kind: "curated_account_set" as const, sourceId: "curated-set:v1:x", sourceItemId: "1", curator: "curator-1", observedAt: T0, trustBoundary: "same_provider" as const }] };
  const reason = explainRecommendation({ candidate }, selection, CATALOG);
  assert.equal(reason.copyKey, "curated_set");
  assert.equal(reason.text, "This account is in a collection by curator-1.");
});

test("only checked evidence earns a badge", () => {
  const checked = describeCandidateEvidence(createFakeAccountCandidate("dana", T0, []));
  assert.deepEqual([checked.showVerifiedBadge, checked.state], [true, "authority_verified"]);
  for (const state of ["unverified_hint", "source_asserted"] as const) {
    const candidate = { ...createFakeAccountCandidate("x", T0, []), verification: { state } };
    const view = describeCandidateEvidence(candidate);
    assert.equal(view.showVerifiedBadge, false, state);
    assert.match(view.text, /Not checked/u);
  }
  assert.equal(describeEventEvidence({ evidenceVerification: "unverified" }).showVerifiedBadge, false);
  assert.equal(describeEventEvidence({ evidenceVerification: "partial" }).showVerifiedBadge, false);
  assert.equal(describeEventEvidence({ evidenceVerification: "verified" }).showVerifiedBadge, true);
});

test("a plan view always asks for confirmation and shows why a plan is blocked", async () => {
  const { onboarding } = setup();
  await onboarding.select(["gaming"]);
  const candidate = (await onboarding.recommend("r1")).items[0]?.recommendation.candidate;
  assert.ok(candidate);
  const { plan } = await onboarding.plan(candidate);
  assert.equal(describePlan(plan).needsConfirmation, true);
  assert.equal(describePlan(plan, { state: "valid" }).blockedReason, undefined);
  assert.equal(describePlan(plan, { state: "stale" }).blockedReason, PLAN_BLOCKED_COPY.stale);
  assert.equal(describePlan(plan, { state: "invalid" }).blockedReason, PLAN_BLOCKED_COPY.invalid);
});
