import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationEvidenceVerificationError,
  assessRecommendationCandidateActionPlan,
  assessRecommendationCandidateActionPlanWithEvidence,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  createRecommendationCuratedAccountSetSourceId,
  normalizeRecommendationEvidenceVerifierOptions,
  type RecommendationCandidate,
  type RecommendationCandidateActionPlan,
  type RecommendationCandidateKind,
  type RecommendationCandidateLifecycleEvent,
  type RecommendationEvidenceKind
} from "../src/index.js";
import { MEMBER_OBSERVED_AT, MEMBER_SET, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
const NOW = "2026-09-26T06:45:00.000Z";
const LATER = "2026-09-26T06:30:00.000Z";
const SET_SOURCE_ID = createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId);
const SUBJECT = "user-123";

function candidate(kind: RecommendationCandidateKind, name = "1"): RecommendationCandidate {
  const nativeId = `https://example.test/${kind === "account" ? "users" : kind}/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol: "activitypub", nativeId, provider: "example.test" }),
    kind, protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available", observedAt: OBSERVED_AT,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "curated_account_set", sourceId: SET_SOURCE_ID, sourceItemId: "pack-1", observedAt: MEMBER_OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}
function packPlan(): RecommendationCandidateActionPlan {
  const value = candidate("starter_pack");
  return createRecommendationCandidateActionPlan({
    candidate: value, eligibility: { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT }, provider: actionProvider("starter_pack"), createdAt: CREATED_AT,
    starterPackMembers: ["alice", "bob"].map((name) => starterPackMember(candidate("account", name), `acct-${name}`))
  });
}
const REVOKED = (name: string): RecommendationCandidateLifecycleEvent => ({ kind: "member_consent_revoked", occurredAt: LATER, candidateId: candidate("account", name).candidateId, setSourceId: SET_SOURCE_ID });
function verifier(verify: (evidence: unknown, kind: RecommendationEvidenceKind, subjectId: string) => unknown, timeoutMs = 50) {
  return normalizeRecommendationEvidenceVerifierOptions({ verifier: { id: "test-keys", verify: (evidence: unknown, context: { kind: RecommendationEvidenceKind; subjectId: string }) => verify(evidence, context.kind, context.subjectId) }, timeoutMs });
}

test("without a verifier the assessment is unverified and matches the plain assessment", async () => {
  const plan = packPlan();
  const plain = assessRecommendationCandidateActionPlan(plan, [REVOKED("alice")], { now: NOW });
  const wrapped = await assessRecommendationCandidateActionPlanWithEvidence(plan, [REVOKED("alice")], { now: NOW, subjectId: SUBJECT });
  assert.equal(plain.evidenceVerification, "unverified");
  assert.equal(plain.verifierId, undefined);
  assert.deepEqual(wrapped, plain);
});

test("an accepting verifier sees each event, member consent and curated-set provenance for the subject", async () => {
  const seen: [string, string][] = [];
  const result = await assessRecommendationCandidateActionPlanWithEvidence(packPlan(), [REVOKED("alice")], {
    now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier((_e, kind, subjectId) => { seen.push([kind, subjectId]); return { verified: true }; })
  });
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "test-keys");
  assert.deepEqual(seen, [["lifecycle_event", SUBJECT], ["starter_pack_consent", SUBJECT], ["starter_pack_consent", SUBJECT], ["starter_pack_provenance", SUBJECT]]);
});

test("verification never makes a plan more usable: the outcome matches the unverified one", async () => {
  const plan = packPlan();
  const events = [REVOKED("alice")];
  const plain = assessRecommendationCandidateActionPlan(plan, events, { now: NOW });
  const checked = await assessRecommendationCandidateActionPlanWithEvidence(plan, events, { now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier(() => ({ verified: true })) });
  assert.equal(checked.state, plain.state);
  assert.equal(checked.usable, plain.usable);
  assert.deepEqual(checked.reasons, plain.reasons);
  assert.equal(checked.state, "invalid");
});

test("a verifier that sees nothing to check does not claim verification", async () => {
  const value = candidate("account", "alice");
  const plan = createRecommendationCandidateActionPlan({ candidate: value, eligibility: { candidate: value, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT }, provider: actionProvider("account"), createdAt: CREATED_AT });
  const result = await assessRecommendationCandidateActionPlanWithEvidence(plan, [], { now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier(() => ({ verified: true })) });
  assert.equal(result.evidenceVerification, "unverified");
});

test("tampered consent or provenance, replay and cross-subject reuse are refused", async () => {
  const plan = packPlan();
  const tamperedKinds: RecommendationEvidenceKind[] = ["starter_pack_consent", "starter_pack_provenance", "lifecycle_event"];
  for (const rejectKind of tamperedKinds) {
    await assert.rejects(
      assessRecommendationCandidateActionPlanWithEvidence(plan, [REVOKED("alice")], { now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier((_e, kind) => ({ verified: kind !== rejectKind })) }),
      (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.kind === rejectKind && error.failure === "rejected"
    );
  }
  const seen = new Set<string>();
  const replayGuard = verifier((evidence) => { const key = JSON.stringify(evidence); if (seen.has(key)) return { verified: false }; seen.add(key); return { verified: true }; });
  await assessRecommendationCandidateActionPlanWithEvidence(plan, [REVOKED("alice")], { now: NOW, subjectId: SUBJECT, evidenceVerifier: replayGuard });
  await assert.rejects(assessRecommendationCandidateActionPlanWithEvidence(plan, [REVOKED("alice")], { now: NOW, subjectId: SUBJECT, evidenceVerifier: replayGuard }), RecommendationEvidenceVerificationError);
  const bound = verifier((_e, _k, subjectId) => ({ verified: subjectId === SUBJECT }));
  await assert.rejects(assessRecommendationCandidateActionPlanWithEvidence(plan, [], { now: NOW, subjectId: "user-456", evidenceVerifier: bound }), RecommendationEvidenceVerificationError);
});

test("throwing, malformed and slow verifiers fail closed", async () => {
  const plan = packPlan();
  const cases: [() => unknown, string][] = [
    [() => { throw new Error("boom"); }, "error"],
    [() => ({ verified: 1 }), "malformed"],
    [() => [true], "malformed"],
    [() => new Promise(() => undefined), "timeout"]
  ];
  for (const [verify, failure] of cases) {
    await assert.rejects(
      assessRecommendationCandidateActionPlanWithEvidence(plan, [], { now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier(verify, 15) }),
      (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === failure
    );
  }
});

test("stored events are not sent back to the verifier but still count against the plan", async () => {
  let calls = 0;
  const result = await assessRecommendationCandidateActionPlanWithEvidence(packPlan(), [], {
    now: NOW, subjectId: SUBJECT, storedEvents: [REVOKED("bob")], evidenceVerifier: verifier((_e, kind) => { if (kind === "lifecycle_event") calls += 1; return { verified: true }; })
  });
  assert.equal(calls, 0);
  assert.equal(result.state, "invalid");
});
