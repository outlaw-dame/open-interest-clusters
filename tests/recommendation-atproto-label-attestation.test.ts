import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  RecommendationEvidenceVerificationError,
  createRecommendationAtprotoLabelAttestation,
  createRecommendationAttestationEvidenceVerifier,
  createRecommendationEvidenceAttestation,
  evaluateRecommendationEvidenceAttestation,
  normalizeRecommendationEvidenceVerifierOptions,
  recommendationEvidenceContentDigest,
  verifyRecommendationEvidence,
  type RecommendationAtprotoLabelAttestationInput
} from "../src/index.js";
import { KEYS, SIGNED_LABELS } from "./atproto-label-vectors.js";

const LABELER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const NOW = "2026-06-01T00:00:00.000Z";
const SUBJECT = "user-1";
const SOURCES = ["at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3kabc"];
const KIND = "starter_pack_provenance" as const;

const didDoc = (multibase: string) => ({
  id: LABELER,
  verificationMethod: [{ id: `${LABELER}#atproto_label`, type: "Multikey", controller: LABELER, publicKeyMultibase: multibase }]
});

function label(index = 0): Record<string, unknown> {
  const vector = SIGNED_LABELS.secp256k1[index]!;
  return { ...vector.label, sig: vector.sig };
}

function issueInput(overrides: Partial<RecommendationAtprotoLabelAttestationInput> = {}): RecommendationAtprotoLabelAttestationInput {
  return {
    label: label(), didDocument: didDoc(KEYS.secp256k1), now: NOW, subjectId: SUBJECT, sourceIds: SOURCES,
    kind: KIND, claim: "label signed by the labeler", verifierId: "label-check", ...overrides
  };
}

function issue(overrides: Partial<RecommendationAtprotoLabelAttestationInput> = {}) {
  const result = createRecommendationAtprotoLabelAttestation(issueInput(overrides));
  assert.equal(result.issued, true);
  return (result as { attestation: ReturnType<typeof createRecommendationEvidenceAttestation> }).attestation;
}

function hook(attestation: unknown, overrides: Partial<Parameters<typeof createRecommendationAttestationEvidenceVerifier>[0]> = {}) {
  const verifier = createRecommendationAttestationEvidenceVerifier({
    id: "label-attestation-check", attestationFor: () => attestation, sourceIdsFor: () => SOURCES,
    requiredProof: "signature", minimumAuthority: "protocol_native", bindContent: true, ...overrides
  });
  return normalizeRecommendationEvidenceVerifierOptions({ verifier, timeoutMs: 50 });
}

const run = (attestation: unknown, evidence: unknown, subject = SUBJECT, now = NOW, overrides = {}) =>
  verifyRecommendationEvidence(hook(attestation, overrides), [evidence], KIND, subject, now);

const rejected = (error: unknown) => error instanceof RecommendationEvidenceVerificationError && error.failure === "rejected";

test("a verified label signature yields a protocol_native signature attestation bound to the label", () => {
  const attestation = issue();
  assert.equal(attestation.mechanism, "atproto_label_signature");
  assert.equal(attestation.proof, "signature");
  assert.equal(attestation.authority, "protocol_native");
  assert.equal(attestation.verifiedAt, NOW);
  assert.equal(attestation.contentDigest, recommendationEvidenceContentDigest(label()));
  assert.equal(attestation.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.ok(Object.isFrozen(attestation));
});

test("end to end through the evidence verifier hook", async () => {
  const result = await run(issue(), label());
  assert.equal(result.evidenceVerification, "verified");
  assert.equal(result.verifierId, "label-attestation-check");
});

test("no attestation is issued for a wrong key, other curve, tampered label or bad DID document", () => {
  const tampered = { ...label(), val: "ok" };
  const cases: Array<[string, Partial<RecommendationAtprotoLabelAttestationInput>, string]> = [
    ["wrong key", { didDocument: didDoc(KEYS.p256) }, "signature_mismatch"],
    ["tampered label", { label: tampered }, "signature_mismatch"],
    ["no label key", { didDocument: { id: LABELER, verificationMethod: [] } }, "key_not_found"],
    ["junk label", { label: "nope" }, "malformed_label"],
    ["junk document", { didDocument: null }, "did_mismatch"],
    ["bad clock", { now: "later" }, "invalid_clock"]
  ];
  for (const [name, overrides, reason] of cases) {
    assert.deepEqual(createRecommendationAtprotoLabelAttestation(issueInput(overrides)), { issued: false, reason }, name);
  }
});

test("a signed retraction and an expired label are refused, not attested", () => {
  assert.deepEqual(createRecommendationAtprotoLabelAttestation(issueInput({ label: label(2) })), { issued: false, reason: "negated_label" });
  assert.deepEqual(createRecommendationAtprotoLabelAttestation(issueInput({ now: "2031-01-01T00:00:00.000Z" })), { issued: false, reason: "expired" });
});

test("a label with a getter or a class instance is refused so the checked data is the digested data", () => {
  const sneaky = { ...label() };
  Object.defineProperty(sneaky, "val", { get: () => "spam", enumerable: true });
  assert.deepEqual(createRecommendationAtprotoLabelAttestation(issueInput({ label: sneaky })), { issued: false, reason: "malformed_label" });
  assert.equal(createRecommendationAtprotoLabelAttestation(issueInput({ evidence: new Date() })).issued, false);
});

test("invalid attestation fields give a fixed refusal and never throw", () => {
  for (const overrides of [{ subjectId: "" }, { sourceIds: [] }, { kind: "x" as never }, { claim: " padded " }, { verifierId: "" }]) {
    assert.deepEqual(createRecommendationAtprotoLabelAttestation(issueInput(overrides)), { issued: false, reason: "invalid_attestation_input" });
  }
});

test("evidence changed after attestation fails the digest check", async () => {
  const attestation = issue();
  for (const changed of [{ ...label(), val: "ok" }, { ...label(), extra: 1 }, { ...label(), sig: label(1).sig }, {}]) {
    await assert.rejects(run(attestation, changed), rejected);
  }
  assert.deepEqual(
    evaluateRecommendationEvidenceAttestation(attestation, {
      subjectId: SUBJECT, sourceIds: SOURCES, kind: KIND, now: NOW, requiredProof: "signature", minimumAuthority: "protocol_native",
      contentDigest: recommendationEvidenceContentDigest({ other: true })
    }), { verified: false, reason: "digest_mismatch" });
});

test("replay on another subject or other source ids is refused", async () => {
  const attestation = issue();
  await assert.rejects(run(attestation, label(), "user-2"), rejected);
  await assert.rejects(run(attestation, label(), SUBJECT, NOW, { sourceIdsFor: () => ["at://other/app.bsky.feed.post/1"] }), rejected);
  await assert.rejects(run(attestation, label(), SUBJECT, NOW, { sourceIdsFor: () => [...SOURCES, "extra"] }), rejected);
});

test("a stale attestation, or one past the label's expiry, is refused", async () => {
  await assert.rejects(run(issue(), label(), SUBJECT, "2026-06-01T01:00:00.000Z"), rejected);
  const attestation = issue({ now: "2029-12-31T23:59:00.000Z" });
  await assert.rejects(run(attestation, label(), SUBJECT, "2030-01-01T00:00:00.000Z"), rejected);
  assert.deepEqual(
    evaluateRecommendationEvidenceAttestation(attestation, {
      subjectId: SUBJECT, sourceIds: SOURCES, kind: KIND, now: "2030-01-01T00:00:00.000Z", requiredProof: "signature",
      minimumAuthority: "protocol_native", contentDigest: attestation.contentDigest as string
    }), { verified: false, reason: "attestation_expired" });
});

test("a digested attestation is refused by a verifier that does not bind content", async () => {
  await assert.rejects(run(issue(), label(), SUBJECT, NOW, { bindContent: false }), rejected);
  assert.deepEqual(
    evaluateRecommendationEvidenceAttestation(issue(), {
      subjectId: SUBJECT, sourceIds: SOURCES, kind: KIND, now: NOW, requiredProof: "signature", minimumAuthority: "protocol_native"
    }), { verified: false, reason: "digest_unchecked" });
});

test("a binding verifier refuses an attestation that carries no digest, such as an origin one", async () => {
  const legacy = createRecommendationEvidenceAttestation({
    subjectId: SUBJECT, sourceIds: SOURCES, kind: KIND, claim: "read from origin", mechanism: "https_origin",
    authority: "protocol_native", verifiedAt: "2026-05-31T23:59:00.000Z", verifierId: "origin"
  });
  await assert.rejects(run(legacy, label(), SUBJECT, NOW, { requiredProof: "origin" }), rejected);
  // The same origin attestation still works where nothing is bound, and is refused where signatures are required.
  const unbound = await run(legacy, label(), SUBJECT, NOW, { requiredProof: "origin", bindContent: false });
  assert.equal(unbound.evidenceVerification, "verified");
  await assert.rejects(run(legacy, label(), SUBJECT, NOW, { bindContent: false }), rejected);
});

test("a literal copy of an attestation does not count", async () => {
  await assert.rejects(run({ ...issue() }, label()), rejected);
});

test("an ATProto label attestation cannot be created without a digest, and digests are validated", () => {
  const base = {
    subjectId: SUBJECT, sourceIds: SOURCES, kind: KIND, claim: "c", mechanism: "atproto_label_signature" as const,
    authority: "protocol_native" as const, verifiedAt: NOW, verifierId: "v"
  };
  assert.throws(() => createRecommendationEvidenceAttestation(base), TypeError);
  for (const contentDigest of ["", "sha256:abc", `sha256:${"A".repeat(64)}`, `md5:${"a".repeat(64)}`, 5]) {
    assert.throws(() => createRecommendationEvidenceAttestation({ ...base, contentDigest }), TypeError);
  }
  assert.throws(() => createRecommendationEvidenceAttestation({ ...base, contentDigest: `sha256:${"a".repeat(64)}`, expiresAt: "soon" }), TypeError);
});

test("the content digest is canonical and refuses data that is not plain", () => {
  assert.equal(recommendationEvidenceContentDigest({ b: 1, a: [true, null, "x"] }), recommendationEvidenceContentDigest({ a: [true, null, "x"], b: 1 }));
  assert.notEqual(recommendationEvidenceContentDigest({ a: "1" }), recommendationEvidenceContentDigest({ a: 1 }));
  assert.notEqual(recommendationEvidenceContentDigest(new Uint8Array([1])), recommendationEvidenceContentDigest({ $bytes: "AQ==" }) + "x");
  assert.equal(recommendationEvidenceContentDigest(new Uint8Array([1])), recommendationEvidenceContentDigest({ $bytes: "AQ==" }));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: unknown = "x";
  for (let i = 0; i < 40; i += 1) deep = [deep];
  for (const bad of [undefined, () => 1, Symbol("s"), 1n, Number.NaN, Infinity, cyclic, deep, { a: undefined }, new Map(), [, 1], "x".repeat(1_100_000)]) {
    assert.throws(() => recommendationEvidenceContentDigest(bad), TypeError);
  }
  // A key named __proto__ is data, so it changes the digest instead of being dropped.
  const proto = JSON.parse('{"__proto__":{"x":1}}') as unknown;
  assert.notEqual(recommendationEvidenceContentDigest(proto), recommendationEvidenceContentDigest({}));
});

test("a verifier cannot be configured with a non-boolean bindContent", () => {
  assert.throws(() => createRecommendationAttestationEvidenceVerifier({
    id: "x", attestationFor: () => undefined, sourceIdsFor: () => ["a"], requiredProof: "signature",
    minimumAuthority: "protocol_native", bindContent: "yes" as never
  }), TypeError);
});

test("the core entrypoint pulls in no @atproto or @ipld packages", () => {
  const root = new URL("..", import.meta.url).pathname;
  // Compiled tests run from dist/tests, so the package root is two levels up from dist/tests.
  const projectRoot = root.endsWith("/dist/") ? join(root, "..") : root;
  const manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    assert.deepEqual(Object.keys(manifest[field] ?? {}).filter((name) => /^@(atproto|ipld)\//u.test(name) || name === "multiformats"), [], field);
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".js") || path.endsWith(".d.ts")) files.push(path);
    }
  };
  walk(join(projectRoot, "dist", "src"));
  assert.ok(files.length > 50);
  const offenders = files.filter((file) => /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@(?:atproto|ipld)\//u.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
