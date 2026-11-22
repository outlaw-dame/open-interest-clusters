import test from "node:test";
import assert from "node:assert/strict";
import {
  RecommendationEvidenceVerificationError,
  createRecommendationAttestationEvidenceVerifier,
  createRecommendationEvidenceAttestation,
  evaluateRecommendationEvidenceAttestation,
  isIssuedRecommendationEvidenceAttestation,
  normalizeRecommendationEvidenceVerifierOptions,
  recommendationEvidenceContentDigest,
  recommendationProviderDiscoveryAuthorityAtLeast,
  verifyRecommendationEvidence,
  type RecommendationEvidenceAttestationInput,
  type RecommendationEvidenceAttestationRequirement
} from "../src/index.js";

const NOW = "2026-10-01T12:00:00.000Z";
const SUBJECT = "user-1";
const SOURCES = ["set:a", "set:b"];
const EVIDENCE = { id: "item" };
const DIGEST = recommendationEvidenceContentDigest(EVIDENCE);

function input(overrides: Partial<RecommendationEvidenceAttestationInput> = {}): RecommendationEvidenceAttestationInput {
  return {
    subjectId: SUBJECT, sourceIds: SOURCES, kind: "starter_pack_provenance", claim: "membership read from the owner's origin",
    mechanism: "protocol_signature", authority: "protocol_native", verifiedAt: "2026-10-01T11:55:00.000Z", verifierId: "test-check",
    contentDigest: DIGEST, ...overrides
  };
}

function requirement(overrides: Partial<RecommendationEvidenceAttestationRequirement> = {}): RecommendationEvidenceAttestationRequirement {
  return {
    subjectId: SUBJECT, sourceIds: SOURCES, kind: "starter_pack_provenance", now: NOW,
    requiredProof: "signature", minimumAuthority: "protocol_native", contentDigest: DIGEST, ...overrides
  };
}

test("an issued attestation matching subject, sources, age and authority is accepted", () => {
  const attestation = createRecommendationEvidenceAttestation(input());
  assert.equal(attestation.proof, "signature");
  assert.deepEqual(evaluateRecommendationEvidenceAttestation(attestation, requirement()), { verified: true });
  // Source order and duplicates do not matter.
  assert.deepEqual(evaluateRecommendationEvidenceAttestation(attestation, requirement({ sourceIds: ["set:b", "set:a", "set:a"] })), { verified: true });
});

test("the attestation is frozen and cannot be edited into a stronger one", () => {
  const attestation = createRecommendationEvidenceAttestation(input({ mechanism: "https_origin" }));
  assert.ok(Object.isFrozen(attestation) && Object.isFrozen(attestation.sourceIds));
  assert.throws(() => { (attestation as { proof: string }).proof = "signature"; }, TypeError);
  assert.throws(() => { (attestation.sourceIds as string[]).push("x"); }, TypeError);
  assert.equal(attestation.proof, "origin");
});

test("a copy, a literal or a parsed JSON attestation is not trusted", () => {
  const issued = createRecommendationEvidenceAttestation(input());
  for (const forged of [{ ...issued }, JSON.parse(JSON.stringify(issued)), structuredClone(issued), Object.create(issued), null, "x", 7, undefined]) {
    assert.equal(isIssuedRecommendationEvidenceAttestation(forged), false);
    assert.deepEqual(evaluateRecommendationEvidenceAttestation(forged, requirement()), { verified: false, reason: "not_issued" });
  }
});

test("subject, source and kind mismatches are rejected", () => {
  const attestation = createRecommendationEvidenceAttestation(input());
  assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement({ subjectId: "user-2" })) as { reason: string }).reason, "subject_mismatch");
  assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement({ sourceIds: ["set:a"] })) as { reason: string }).reason, "source_mismatch");
  assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement({ sourceIds: [...SOURCES, "set:c"] })) as { reason: string }).reason, "source_mismatch");
  assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement({ sourceIds: ["set:a", "set:z"] })) as { reason: string }).reason, "source_mismatch");
  assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement({ kind: "lifecycle_event" })) as { reason: string }).reason, "kind_mismatch");
});

test("expired and future-dated attestations are rejected, and the age limit is exact", () => {
  const fresh = (verifiedAt: string) => createRecommendationEvidenceAttestation(input({ verifiedAt }));
  assert.equal((evaluateRecommendationEvidenceAttestation(fresh("2026-10-01T11:44:59.999Z"), requirement()) as { reason: string }).reason, "expired");
  assert.deepEqual(evaluateRecommendationEvidenceAttestation(fresh("2026-10-01T11:45:00.000Z"), requirement()), { verified: true });
  assert.equal((evaluateRecommendationEvidenceAttestation(fresh("2026-10-01T12:00:00.001Z"), requirement()) as { reason: string }).reason, "future_dated");
  assert.equal((evaluateRecommendationEvidenceAttestation(fresh("2026-10-01T11:00:00.000Z"), requirement({ maxAgeMs: 3_600_000 })) as { verified: boolean }).verified, true);
});

test("an origin attestation is never accepted where a signed proof is required", () => {
  for (const mechanism of ["https_origin", "authenticated_fetch"] as const) {
    const attestation = createRecommendationEvidenceAttestation(input({ mechanism }));
    assert.equal(attestation.proof, "origin");
    assert.equal((evaluateRecommendationEvidenceAttestation(attestation, requirement()) as { reason: string }).reason, "proof_insufficient");
    assert.deepEqual(evaluateRecommendationEvidenceAttestation(attestation, requirement({ requiredProof: "origin" })), { verified: true });
  }
});

test("a proof field passed in is refused, and an origin mechanism cannot claim a registration-level authority", () => {
  assert.throws(() => createRecommendationEvidenceAttestation({ ...input({ mechanism: "https_origin" }), proof: "signature" }), TypeError);
  assert.throws(() => createRecommendationEvidenceAttestation(input({ mechanism: "https_origin", authority: "explicit_integration" })), TypeError);
  assert.throws(() => createRecommendationEvidenceAttestation(input({ mechanism: "authenticated_fetch", authority: "authenticated_registration" })), TypeError);
  assert.doesNotThrow(() => createRecommendationEvidenceAttestation(input({ mechanism: "protocol_signature", authority: "explicit_integration" })));
});

test("weak authority is rejected and the ordering matches provider discovery", () => {
  const weak = createRecommendationEvidenceAttestation(input({ authority: "provider_probe" }));
  assert.equal((evaluateRecommendationEvidenceAttestation(weak, requirement()) as { reason: string }).reason, "authority_insufficient");
  assert.equal(recommendationProviderDiscoveryAuthorityAtLeast("authenticated_registration", "explicit_integration"), true);
  assert.equal(recommendationProviderDiscoveryAuthorityAtLeast("provider_probe", "protocol_native"), false);
  assert.equal(recommendationProviderDiscoveryAuthorityAtLeast("nope" as never, "protocol_native"), false);
});

test("malformed and oversized input is refused", () => {
  const bad: unknown[] = [
    null, [], "x", { ...input(), extra: 1 },
    input({ subjectId: "" }), input({ subjectId: " pad" }), input({ subjectId: "a\u0000b" }), input({ subjectId: "a".repeat(513) }),
    input({ sourceIds: [] }), input({ sourceIds: ["ok", "bad\nid"] }), input({ sourceIds: ["a".repeat(513)] }),
    input({ sourceIds: Array.from({ length: 33 }, (_, i) => `s${i}`) }), { ...input(), sourceIds: "set:a" },
    input({ claim: "x".repeat(257) }), input({ claim: "line\u0085break" }), input({ claim: "" }),
    input({ kind: "other" as never }), input({ mechanism: "magic" as never }), input({ authority: "root" as never }),
    input({ verifiedAt: "yesterday" }), input({ verifiedAt: "2026-02-30T00:00:00Z" }), input({ verifierId: "v".repeat(129) }),
    { ...input(), subjectId: 5 }
  ];
  for (const value of bad) {
    assert.throws(() => createRecommendationEvidenceAttestation(value), TypeError, JSON.stringify(value)?.slice(0, 80));
  }
});

test("a bad requirement is a programming error and throws", () => {
  const attestation = createRecommendationEvidenceAttestation(input());
  for (const bad of [
    requirement({ subjectId: "" }), requirement({ sourceIds: [] }), requirement({ now: "soon" }), requirement({ maxAgeMs: 0 }),
    requirement({ maxAgeMs: 8 * 24 * 60 * 60_000 }), requirement({ maxAgeMs: 1.5 }), requirement({ requiredProof: "any" as never }),
    requirement({ minimumAuthority: "root" as never }), requirement({ kind: "x" as never })
  ]) assert.throws(() => evaluateRecommendationEvidenceAttestation(attestation, bad), TypeError);
});

// The hook, end to end.
function configured(overrides: Partial<Parameters<typeof createRecommendationAttestationEvidenceVerifier>[0]> = {}, attestations = new Map<unknown, unknown>()) {
  const verifier = createRecommendationAttestationEvidenceVerifier({
    id: "attestation-check",
    attestationFor: (evidence) => attestations.get(evidence),
    sourceIdsFor: () => SOURCES,
    requiredProof: "signature",
    minimumAuthority: "protocol_native",
    ...overrides
  });
  return normalizeRecommendationEvidenceVerifierOptions({ verifier, timeoutMs: 50 });
}

test("the hook yields verified only for a matching issued attestation", async () => {
  const evidence = { id: "item" };
  const result = await verifyRecommendationEvidence(
    configured({}, new Map([[evidence, createRecommendationEvidenceAttestation(input())]])), [evidence], "starter_pack_provenance", SUBJECT, NOW);
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "attestation-check");
});

test("the hook rejects missing, forged, mismatched, expired and origin-only attestations", async () => {
  const evidence = { id: "item" };
  const cases: Array<[string, unknown, string?]> = [
    ["missing", undefined],
    ["forged", { ...createRecommendationEvidenceAttestation(input()) }],
    ["other subject", createRecommendationEvidenceAttestation(input({ subjectId: "user-2" }))],
    ["other sources", createRecommendationEvidenceAttestation(input({ sourceIds: ["set:a"] }))],
    ["expired", createRecommendationEvidenceAttestation(input({ verifiedAt: "2026-09-01T00:00:00.000Z" }))],
    ["future", createRecommendationEvidenceAttestation(input({ verifiedAt: "2026-10-02T00:00:00.000Z" }))],
    ["origin only", createRecommendationEvidenceAttestation(input({ mechanism: "https_origin" }))]
  ];
  for (const [label, attestation] of cases) {
    await assert.rejects(
      verifyRecommendationEvidence(configured({}, new Map([[evidence, attestation]])), [evidence], "starter_pack_provenance", SUBJECT, NOW),
      (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "rejected", label);
  }
});

test("the hook accepts an origin attestation where only origin proof is required", async () => {
  const evidence = { id: "item" };
  const attestation = createRecommendationEvidenceAttestation(input({ mechanism: "https_origin", authority: "protocol_native" }));
  const result = await verifyRecommendationEvidence(
    configured({ requiredProof: "origin" }, new Map([[evidence, attestation]])), [evidence], "starter_pack_provenance", SUBJECT, NOW);
  assert.equal(result.evidenceVerification, "verified");
});

test("a lookup that throws, hangs or returns a bad source list still fails closed", async () => {
  const good = createRecommendationEvidenceAttestation(input());
  await assert.rejects(
    verifyRecommendationEvidence(configured({ attestationFor: () => { throw new Error("db down"); } }), [{ id: "item" }], "starter_pack_provenance", SUBJECT, NOW),
    (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "error");
  let aborted = false;
  await assert.rejects(
    verifyRecommendationEvidence(
      configured({ attestationFor: (_evidence, context) => new Promise((resolve) => { context.signal.addEventListener("abort", () => { aborted = true; resolve(good); }); }) }),
      [{ id: "item" }], "starter_pack_provenance", SUBJECT, NOW),
    (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "timeout");
  assert.equal(aborted, true);
  await assert.rejects(
    verifyRecommendationEvidence(configured({ attestationFor: () => good, sourceIdsFor: () => [] }), [{ id: "item" }], "starter_pack_provenance", SUBJECT, NOW),
    (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "error");
});

test("the verifier factory refuses bad options up front", () => {
  const base = { id: "x", attestationFor: () => undefined, sourceIdsFor: () => ["a"], requiredProof: "signature" as const, minimumAuthority: "protocol_native" as const };
  assert.throws(() => createRecommendationAttestationEvidenceVerifier({ ...base, id: "" }), TypeError);
  assert.throws(() => createRecommendationAttestationEvidenceVerifier({ ...base, attestationFor: undefined as never }), TypeError);
  assert.throws(() => createRecommendationAttestationEvidenceVerifier({ ...base, requiredProof: "none" as never }), TypeError);
  assert.throws(() => createRecommendationAttestationEvidenceVerifier({ ...base, maxAgeMs: -1 }), TypeError);
  assert.doesNotThrow(() => createRecommendationAttestationEvidenceVerifier(base));
});

test("a byte array and a plain object that looks like its JSON form never share a digest", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const lookalike = { $bytes: Buffer.from(bytes).toString("base64") };
  assert.notEqual(recommendationEvidenceContentDigest(bytes), recommendationEvidenceContentDigest(lookalike));
  assert.notEqual(recommendationEvidenceContentDigest({ a: bytes }), recommendationEvidenceContentDigest({ a: lookalike }));
  // A string that spells out the encoding is still a quoted string, so it differs too.
  assert.notEqual(recommendationEvidenceContentDigest(bytes), recommendationEvidenceContentDigest(`bytes("${lookalike.$bytes}")`));
  // Same bytes still give the same digest, and different bytes do not.
  assert.equal(recommendationEvidenceContentDigest(bytes), recommendationEvidenceContentDigest(new Uint8Array([1, 2, 3])));
  assert.notEqual(recommendationEvidenceContentDigest(bytes), recommendationEvidenceContentDigest(new Uint8Array([1, 2, 4])));
});

// Digest binding is mandatory for every mechanism.
test("an attestation without a valid digest cannot be issued, for any mechanism", () => {
  for (const mechanism of ["https_origin", "authenticated_fetch", "protocol_signature", "application_signature", "atproto_label_signature"] as const) {
    const { contentDigest: _omitted, ...withoutDigest } = input({ mechanism, authority: "protocol_native" });
    assert.throws(() => createRecommendationEvidenceAttestation(withoutDigest), TypeError, mechanism);
    for (const bad of [undefined, null, "", "sha256:abc", `sha256:${"A".repeat(64)}`, `md5:${"a".repeat(64)}`, 5]) {
      assert.throws(() => createRecommendationEvidenceAttestation({ ...withoutDigest, contentDigest: bad }), TypeError, `${mechanism} ${String(bad)}`);
    }
  }
});

test("the evaluator needs a requirement digest and rejects a wrong or other-content digest", () => {
  const attestation = createRecommendationEvidenceAttestation(input());
  const { contentDigest: _omitted, ...withoutDigest } = requirement();
  assert.throws(() => evaluateRecommendationEvidenceAttestation(attestation, withoutDigest as never), TypeError);
  assert.throws(() => evaluateRecommendationEvidenceAttestation(attestation, requirement({ contentDigest: "sha256:nope" })), TypeError);
  const wrong = `sha256:${"0".repeat(64)}`;
  assert.deepEqual(evaluateRecommendationEvidenceAttestation(attestation, requirement({ contentDigest: wrong })), { verified: false, reason: "digest_mismatch" });
  const other = recommendationEvidenceContentDigest({ id: "item", extra: 1 });
  assert.deepEqual(evaluateRecommendationEvidenceAttestation(attestation, requirement({ contentDigest: other })), { verified: false, reason: "digest_mismatch" });
});

test("the hook always checks the digest: other content, wrong digest, cross-subject and cross-source replay are all rejected", async () => {
  const verifyWith = (attestation: unknown, evidence: unknown, subject = SUBJECT, sources: readonly string[] = SOURCES) => verifyRecommendationEvidence(
    configured({ sourceIdsFor: () => sources }, new Map([[evidence, attestation]])), [evidence], "starter_pack_provenance", subject, NOW);
  const rejected = (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "rejected";
  const good = createRecommendationEvidenceAttestation(input());
  assert.equal((await verifyWith(good, EVIDENCE)).evidenceVerification, "verified");
  // Same subject and sources, but the evidence handed to the hook is different content.
  await assert.rejects(verifyWith(good, { id: "item", injected: true }), rejected);
  // The attestation carries a digest of something else.
  await assert.rejects(verifyWith(createRecommendationEvidenceAttestation(input({ contentDigest: `sha256:${"1".repeat(64)}` })), EVIDENCE), rejected);
  // Replay against another subject, and against another source set, with the right content.
  await assert.rejects(verifyWith(good, EVIDENCE, "user-2"), rejected);
  await assert.rejects(verifyWith(good, EVIDENCE, SUBJECT, ["set:a", "set:other"]), rejected);
  // Evidence that cannot be digested fails closed, it is never skipped.
  const notPlain = { get id() { return "item"; } };
  await assert.rejects(verifyWith(good, notPlain), (error: unknown) => error instanceof RecommendationEvidenceVerificationError);
  // Every mechanism and strength is bound the same way.
  for (const mechanism of ["https_origin", "authenticated_fetch", "protocol_signature", "application_signature"] as const) {
    const attestation = createRecommendationEvidenceAttestation(input({ mechanism, contentDigest: `sha256:${"2".repeat(64)}` }));
    await assert.rejects(
      verifyRecommendationEvidence(configured({ requiredProof: "origin" }, new Map([[EVIDENCE, attestation]])), [EVIDENCE], "starter_pack_provenance", SUBJECT, NOW), rejected, mechanism);
  }
});

test("bindContent is gone and a verifier configured with it is refused", () => {
  const base = { id: "x", attestationFor: () => undefined, sourceIdsFor: () => ["a"], requiredProof: "signature" as const, minimumAuthority: "protocol_native" as const };
  for (const bindContent of [true, false, "yes"]) {
    assert.throws(() => createRecommendationAttestationEvidenceVerifier({ ...base, bindContent } as never), TypeError);
  }
});
