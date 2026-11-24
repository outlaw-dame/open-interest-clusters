import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RECOMMENDATION_EVIDENCE_ATTESTATIONS_PER_CALL,
  RecommendationEvidenceVerificationError,
  assessRecommendationCandidateActionPlanWithEvidence,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  createRecommendationCuratedAccountSetSourceId,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationEvidenceAttestation,
  createRecommendationOnboardingLifecycle,
  normalizeRecommendationCandidateLifecycleEvents,
  normalizeRecommendationEvidenceVerificationOptions,
  recommendationEvidenceAttestationSourceIds,
  recommendationEvidenceContentDigest,
  type RecommendationCandidate,
  type RecommendationCandidateActionPlan,
  type RecommendationCandidateLifecycleEvent,
  type RecommendationDerivedStateInvalidationRequest,
  type RecommendationEvidenceAttestationInput,
  type RecommendationEvidenceKind
} from "../src/index.js";
import { MEMBER_OBSERVED_AT, MEMBER_SET, actionProvider, starterPackMember } from "./recommendation-candidate-action-plan-fixtures.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";
const LATER = "2026-09-26T06:30:00.000Z";
const NOW = "2026-09-26T06:45:00.000Z";
const FRESH = "2026-09-26T06:40:00.000Z";
const SUBJECT = "user-123";
const OTHER_SUBJECT = "user-456";
const SET_SOURCE_ID = createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId);

function candidate(kind: "account" | "starter_pack", name = "1"): RecommendationCandidate {
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
const REVOKED: RecommendationCandidateLifecycleEvent = { kind: "member_consent_revoked", occurredAt: LATER, candidateId: candidate("account", "alice").candidateId, setSourceId: SET_SOURCE_ID };

const PLAN = packPlan();
// These are the exact objects the lifecycle hands to the verifier.
const [EVENT] = normalizeRecommendationCandidateLifecycleEvents([REVOKED], { now: NOW });
const EVIDENCE: Record<RecommendationEvidenceKind, readonly unknown[]> = {
  lifecycle_event: [EVENT],
  starter_pack_consent: PLAN.members ?? [],
  starter_pack_provenance: PLAN.candidate.provenance.filter((item) => item.kind === "curated_account_set")
};

function attest(kind: RecommendationEvidenceKind, evidence: unknown, overrides: Partial<RecommendationEvidenceAttestationInput> = {}) {
  return createRecommendationEvidenceAttestation({
    subjectId: SUBJECT, sourceIds: recommendationEvidenceAttestationSourceIds(kind, evidence), kind, claim: "read from the owner's origin",
    mechanism: "protocol_signature", authority: "protocol_native", verifiedAt: FRESH, verifierId: "test-check",
    contentDigest: recommendationEvidenceContentDigest(evidence), ...overrides
  });
}
function attestAll() {
  return (Object.keys(EVIDENCE) as RecommendationEvidenceKind[]).flatMap((kind) => EVIDENCE[kind].map((item) => attest(kind, item)));
}
const policy = (extra: Record<string, unknown> = {}) => normalizeRecommendationEvidenceVerificationOptions({ minimumAttestation: "signature", ...extra });

function assess(attestations: readonly unknown[] | undefined, evidenceVerifier = policy(), subjectId = SUBJECT) {
  return assessRecommendationCandidateActionPlanWithEvidence(PLAN, [EVENT!], {
    now: NOW, subjectId, evidenceVerifier, ...(attestations === undefined ? {} : { attestations })
  });
}

async function refused(promise: Promise<unknown>, kind?: RecommendationEvidenceKind) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof RecommendationEvidenceVerificationError, "expected a verification refusal");
  assert.equal(error.failure, "rejected");
  if (kind !== undefined) assert.equal(error.kind, kind);
  // The message is fixed text: it never carries the subject, a source id or any evidence content.
  assert.equal(error.message, `Recommendation evidence verification failed (${error.kind}: rejected).`);
  for (const secret of [SUBJECT, OTHER_SUBJECT, SET_SOURCE_ID, "example.test", "sha256:"]) assert.ok(!error.message.includes(secret));
  assert.equal(error.cause, undefined);
}

test("evidence is accepted when every item has a valid attestation", async () => {
  const result = await assess(attestAll());
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "attestation-policy");
  assert.deepEqual([...result.verifiedKinds], ["lifecycle_event", "starter_pack_consent", "starter_pack_provenance"]);
});

test("with the policy on and no attestations, every kind is refused", async () => {
  await refused(assess(undefined), "lifecycle_event");
  await refused(assess([]), "lifecycle_event");
  // Only the events are covered, so the next kind in line is the one refused.
  await refused(assess(EVIDENCE.lifecycle_event.map((item) => attest("lifecycle_event", item))), "starter_pack_consent");
  const withoutProvenance = attestAll().filter((item) => item.kind !== "starter_pack_provenance");
  await refused(assess(withoutProvenance), "starter_pack_provenance");
});

test("one uncovered item among many is enough to refuse the call", async () => {
  const all = attestAll();
  const dropped = all.filter((item) => !(item.kind === "starter_pack_consent" && item.sourceIds.some((id) => id.includes("acct-bob") || id.includes("bob"))));
  assert.ok(dropped.length < all.length);
  await refused(assess(dropped), "starter_pack_consent");
});

test("an attestation for another subject is refused, including replay of a valid set", async () => {
  const forOther = (Object.keys(EVIDENCE) as RecommendationEvidenceKind[]).flatMap((kind) => EVIDENCE[kind].map((item) => attest(kind, item, { subjectId: OTHER_SUBJECT })));
  await refused(assess(forOther), "lifecycle_event");
  // The same attestations are good for their own subject and useless for the first one's.
  assert.equal((await assess(forOther, policy(), OTHER_SUBJECT)).evidenceVerification, "verified");
  const mine = attestAll();
  await refused(assess(mine, policy(), OTHER_SUBJECT), "lifecycle_event");
});

test("an attestation that lists other source ids is refused", async () => {
  const wrong = attestAll().map((item) => attest(item.kind, EVIDENCE[item.kind].find((evidence) => recommendationEvidenceContentDigest(evidence) === item.contentDigest), { sourceIds: ["set:somewhere-else"] }));
  await refused(assess(wrong), "lifecycle_event");
  // Listing the right ids plus an extra one is not an exact match either.
  const extra = attestAll().map((item) => attest(item.kind, EVIDENCE[item.kind].find((evidence) => recommendationEvidenceContentDigest(evidence) === item.contentDigest), { sourceIds: [...item.sourceIds, "set:extra"] }));
  await refused(assess(extra), "lifecycle_event");
});

test("an attestation for different content is refused", async () => {
  const otherEvent = { ...(EVENT as object), occurredAt: "2026-09-26T06:31:00.000Z" };
  const swapped = attestAll().filter((item) => item.kind !== "lifecycle_event");
  swapped.push(attest("lifecycle_event", otherEvent, { sourceIds: recommendationEvidenceAttestationSourceIds("lifecycle_event", EVENT) }));
  await refused(assess(swapped), "lifecycle_event");
});

test("an expired, future-dated or past-expiry attestation is refused", async () => {
  const build = (overrides: Partial<RecommendationEvidenceAttestationInput>) =>
    (Object.keys(EVIDENCE) as RecommendationEvidenceKind[]).flatMap((kind) => EVIDENCE[kind].map((item) => attest(kind, item, overrides)));
  await refused(assess(build({ verifiedAt: "2026-09-26T05:00:00.000Z" })), "lifecycle_event");
  await refused(assess(build({ verifiedAt: "2026-09-26T07:00:00.000Z" })), "lifecycle_event");
  await refused(assess(build({ expiresAt: "2026-09-26T06:44:00.000Z" })), "lifecycle_event");
  // A longer age limit makes the old one acceptable, so the refusal above really was about age.
  const old = build({ verifiedAt: "2026-09-26T05:00:00.000Z" });
  assert.equal((await assess(old, policy({ attestationMaxAgeMs: 3 * 60 * 60_000 }))).evidenceVerification, "verified");
});

test("an origin attestation is too weak when a signature is required, and enough when origin is required", async () => {
  const origin = (Object.keys(EVIDENCE) as RecommendationEvidenceKind[]).flatMap((kind) => EVIDENCE[kind].map((item) => attest(kind, item, { mechanism: "https_origin" })));
  await refused(assess(origin), "lifecycle_event");
  assert.equal((await assess(origin, policy({ minimumAttestation: "origin" }))).evidenceVerification, "verified");
  // Signed attestations satisfy an origin requirement too.
  assert.equal((await assess(attestAll(), policy({ minimumAttestation: "origin" }))).evidenceVerification, "verified");
});

test("an attestation below the minimum authority is refused", async () => {
  const weak = (Object.keys(EVIDENCE) as RecommendationEvidenceKind[]).flatMap((kind) => EVIDENCE[kind].map((item) => attest(kind, item, { authority: "provider_probe" })));
  await refused(assess(weak), "lifecycle_event");
  assert.equal((await assess(weak, policy({ minimumAttestationAuthority: "provider_probe" }))).evidenceVerification, "verified");
});

test("an attestation for the wrong kind, and look-alike objects, are refused", async () => {
  const wrongKind = EVIDENCE.lifecycle_event.map((item) => createRecommendationEvidenceAttestation({
    subjectId: SUBJECT, sourceIds: recommendationEvidenceAttestationSourceIds("lifecycle_event", item), kind: "starter_pack_consent", claim: "wrong kind",
    mechanism: "protocol_signature", authority: "protocol_native", verifiedAt: FRESH, verifierId: "test-check", contentDigest: recommendationEvidenceContentDigest(item)
  }));
  await refused(assess(wrongKind), "lifecycle_event");
  const forged = attestAll().map((item) => ({ ...item }));
  await refused(assess(forged), "lifecycle_event");
  await refused(assess(JSON.parse(JSON.stringify(attestAll())) as unknown[]), "lifecycle_event");
  await refused(assess([null, 7, "x", undefined] as unknown[]), "lifecycle_event");
});

test("evidence that cannot be hashed or names no source is refused", async () => {
  const noSource = { kind: "member_consent_revoked", occurredAt: LATER };
  assert.throws(() => recommendationEvidenceAttestationSourceIds("lifecycle_event", noSource), TypeError);
  assert.throws(() => recommendationEvidenceAttestationSourceIds("lifecycle_event", null), TypeError);
});

test("an app verifier runs after the policy and can still refuse", async () => {
  const seen: string[] = [];
  const verifier = { id: "app-check", verify: (_evidence: unknown, context: { kind: string }) => { seen.push(context.kind); return { verified: context.kind !== "starter_pack_provenance" }; } };
  const combined = policy({ verifier });
  await refused(assess(attestAll(), combined), "starter_pack_provenance");
  assert.ok(seen.includes("lifecycle_event"));
  // Without attestations the app verifier is never reached.
  seen.length = 0;
  await refused(assess([], combined), "lifecycle_event");
  assert.deepEqual(seen, []);
  const accepting = policy({ verifier: { id: "app-check", verify: () => ({ verified: true }) } });
  const ok = await assess(attestAll(), accepting);
  assert.equal(ok.verifierId, "app-check");
  assert.equal(ok.evidenceVerification, "verified");
});

test("with the setting absent, behavior and the unverified label are unchanged", async () => {
  const plain = await assessRecommendationCandidateActionPlanWithEvidence(PLAN, [EVENT!], { now: NOW, subjectId: SUBJECT });
  assert.equal(plain.evidenceVerification, "unverified");
  // A plain verifier is not wrapped and attestations passed alongside are not required.
  const verifier = normalizeRecommendationEvidenceVerificationOptions({ verifier: { id: "plain", verify: () => ({ verified: true }) } });
  const result = await assessRecommendationCandidateActionPlanWithEvidence(PLAN, [EVENT!], { now: NOW, subjectId: SUBJECT, evidenceVerifier: verifier });
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "plain");
  assert.throws(() => normalizeRecommendationEvidenceVerificationOptions({}), TypeError);
});

test("a bad policy setting fails when it is configured", () => {
  for (const bad of [{ minimumAttestation: "any" }, { minimumAttestation: true }, { minimumAttestation: undefined }, { minimumAttestation: "signature", minimumAttestationAuthority: "nope" }, { minimumAttestation: "signature", attestationMaxAgeMs: 0 }, { minimumAttestation: "signature", verifier: { id: "", verify: () => ({ verified: true }) } }]) {
    assert.throws(() => normalizeRecommendationEvidenceVerificationOptions(bad), TypeError);
  }
});

function lifecycleWith(evidenceVerifier: unknown) {
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore(), allowEmptySubjectInitialization: true, now: () => LATER });
  const calls: RecommendationDerivedStateInvalidationRequest[] = [];
  const invalidator = { async invalidate(request: RecommendationDerivedStateInvalidationRequest) { calls.push(request); } };
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({ engine, now: () => LATER, invalidators: { embeddings: invalidator, candidate_cache: invalidator, explanation_cache: invalidator } });
  const lifecycle = createRecommendationOnboardingLifecycle({ derived, engine, now: () => NOW, evidenceVerifier: evidenceVerifier as never });
  return { lifecycle, calls };
}

test("the lifecycle refuses unattested events before clearing any cache, and accepts attested ones", async () => {
  const { lifecycle, calls } = lifecycleWith({ minimumAttestation: "signature" });
  await refused(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], now: NOW }), "lifecycle_event");
  await refused(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], attestations: [attest("lifecycle_event", EVENT, { subjectId: OTHER_SUBJECT })], now: NOW }), "lifecycle_event");
  assert.equal(calls.length, 0, "nothing was cleared for refused evidence");
  const result = await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], attestations: [attest("lifecycle_event", EVENT)], now: NOW });
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.acceptedEventCount, 1);
  assert.ok(calls.length > 0, "accepted evidence clears caches");
});

test("the lifecycle without the setting reports unverified and ignores attestations", async () => {
  const { lifecycle, calls } = lifecycleWith(undefined);
  const result = await lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], now: NOW });
  assert.equal(result.evidenceVerification, "unverified");
  assert.ok(calls.length > 0);
});

test("the lifecycle bounds the attestation list", async () => {
  const { lifecycle, calls } = lifecycleWith({ minimumAttestation: "signature" });
  const tooMany = new Array(MAX_RECOMMENDATION_EVIDENCE_ATTESTATIONS_PER_CALL + 1).fill(attest("lifecycle_event", EVENT));
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], attestations: tooMany, now: NOW }), TypeError);
  await assert.rejects(lifecycle.reportCandidateEvents({ subjectId: SUBJECT, events: [REVOKED], attestations: "nope" as never, now: NOW }), TypeError);
  assert.equal(calls.length, 0);
});
