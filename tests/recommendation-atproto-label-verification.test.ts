import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeRecommendationAtprotoLabelForSigning,
  verifyRecommendationAtprotoLabelSignature
} from "../src/recommendation/atproto-label-verification.js";
import {
  INTEGER_VECTORS,
  KEYS,
  REPEATED_STRING_VECTORS,
  SIGNED_LABELS,
  STRING_VECTORS
} from "./atproto-label-vectors.js";

const NOW = "2026-06-01T00:00:00.000Z";
const LABELER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz";
const K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function didDoc(multibase: string, overrides: Record<string, unknown> = {}) {
  return {
    id: LABELER,
    verificationMethod: [
      { id: `${LABELER}#atproto_label`, type: "Multikey", controller: LABELER, publicKeyMultibase: multibase, ...overrides }
    ]
  };
}

function signed(curve: "secp256k1" | "p256", index = 0) {
  const vector = SIGNED_LABELS[curve][index]!;
  return { ...vector.label, sig: vector.sig } as Record<string, unknown>;
}

function verifyWith(label: unknown, didDocument: unknown, now = NOW) {
  return verifyRecommendationAtprotoLabelSignature({ label, didDocument, now });
}

function flipToHighS(sigBase64: string, order: bigint): string {
  const sig = Buffer.from(sigBase64, "base64");
  const s = BigInt(`0x${sig.subarray(32).toString("hex")}`);
  Buffer.from((order - s).toString(16).padStart(64, "0"), "hex").copy(sig, 32);
  return sig.toString("base64");
}

test("encoder matches dag-cbor output for signed label vectors", () => {
  for (const curve of ["secp256k1", "p256"] as const) {
    for (const vector of SIGNED_LABELS[curve]) {
      assert.equal(Buffer.from(encodeRecommendationAtprotoLabelForSigning(vector.label)).toString("hex"), vector.cbor);
    }
  }
});

test("encoder uses the shortest integer form at every size boundary", () => {
  for (const { v, cbor } of INTEGER_VECTORS) {
    assert.equal(Buffer.from(encodeRecommendationAtprotoLabelForSigning({ ver: v })).toString("hex"), cbor);
  }
});

test("encoder matches dag-cbor for string length boundaries and multibyte text", () => {
  for (const { s, cbor } of STRING_VECTORS) {
    assert.equal(Buffer.from(encodeRecommendationAtprotoLabelForSigning({ val: s })).toString("hex"), cbor);
  }
  for (const { repeat, head } of REPEATED_STRING_VECTORS) {
    const bytes = encodeRecommendationAtprotoLabelForSigning({ val: "x".repeat(repeat) });
    const headBytes = Buffer.from(head, "hex");
    assert.deepEqual(Buffer.from(bytes.subarray(0, headBytes.length)), headBytes);
    assert.equal(bytes.length, headBytes.length + repeat);
    assert.ok(bytes.subarray(headBytes.length).every((byte) => byte === 0x78));
  }
});

test("encoder ignores sig and key order, and rejects shapes outside the label", () => {
  const a = encodeRecommendationAtprotoLabelForSigning({ val: "spam", ver: 1, sig: "ignored" });
  const b = encodeRecommendationAtprotoLabelForSigning({ ver: 1, val: "spam" });
  assert.deepEqual(a, b);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ ver: 1.5 }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ ver: -1 }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ ver: 2 ** 32 }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ val: 5 }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ neg: "true" }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ extra: "x" }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ val: "\ud800" }), TypeError);
  assert.throws(() => encodeRecommendationAtprotoLabelForSigning({ val: "x".repeat(9_000) }), TypeError);
});

test("verifies official-library signatures for secp256k1 and P-256 labels", () => {
  for (const curve of ["secp256k1", "p256"] as const) {
    SIGNED_LABELS[curve].forEach((vector, index) => {
      const result = verifyWith(signed(curve, index), didDoc(KEYS[curve]));
      assert.equal(result.verified, true, `${curve} #${index}`);
      if (result.verified) {
        assert.equal(result.keyType, curve);
        assert.equal(result.negated, vector.label.neg === true);
        assert.equal(result.hasExpiry, vector.label.exp !== undefined);
      }
    });
  }
});

test("accepts the signature as bytes, unpadded base64 or the JSON $bytes form", () => {
  const base = signed("secp256k1");
  const raw = new Uint8Array(Buffer.from(base.sig as string, "base64"));
  for (const sig of [raw, { $bytes: base.sig }, (base.sig as string).replace(/=+$/u, "")]) {
    assert.equal(verifyWith({ ...base, sig }, didDoc(KEYS.secp256k1)).verified, true);
  }
});

test("a change to any signed field breaks the signature", () => {
  const base = signed("secp256k1");
  const changes: Record<string, unknown> = {
    src: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
    uri: "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3kabd",
    cid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitaf",
    val: "spam2",
    neg: true,
    cts: "2024-01-02T03:04:06.000Z",
    exp: "2031-01-01T00:00:00.000Z"
  };
  for (const [field, value] of Object.entries(changes)) {
    // The labeler DID is also the key lookup, so a changed src fails earlier with did_mismatch.
    const expected = field === "src" ? "did_mismatch" : "signature_mismatch";
    const result = verifyWith({ ...base, [field]: value }, didDoc(KEYS.secp256k1));
    assert.deepEqual(result, { verified: false, reason: expected }, field);
  }
  const unsigned = { ...base };
  delete unsigned.neg;
  assert.deepEqual(verifyWith(unsigned, didDoc(KEYS.secp256k1)), { verified: false, reason: "signature_mismatch" });
});

test("a changed src passes the key lookup only when the document is for that DID", () => {
  const other = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
  const doc = { ...didDoc(KEYS.secp256k1), id: other, verificationMethod: [{ id: "#atproto_label", type: "Multikey", publicKeyMultibase: KEYS.secp256k1 }] };
  assert.deepEqual(verifyWith({ ...signed("secp256k1"), src: other }, doc), { verified: false, reason: "signature_mismatch" });
});

test("fails on the wrong key, including a key from the other curve", () => {
  assert.deepEqual(verifyWith(signed("secp256k1"), didDoc(KEYS.p256)), { verified: false, reason: "signature_mismatch" });
  assert.deepEqual(verifyWith(signed("p256"), didDoc(KEYS.secp256k1)), { verified: false, reason: "signature_mismatch" });
  // A valid signature for a different label of the same labeler does not carry over.
  const swapped = { ...signed("secp256k1", 0), sig: SIGNED_LABELS.secp256k1[1]!.sig };
  assert.deepEqual(verifyWith(swapped, didDoc(KEYS.secp256k1)), { verified: false, reason: "signature_mismatch" });
});

test("rejects high-S signatures even though the math verifies", () => {
  const k1 = signed("secp256k1");
  const p256 = signed("p256");
  assert.deepEqual(
    verifyWith({ ...k1, sig: flipToHighS(k1.sig as string, K1_ORDER) }, didDoc(KEYS.secp256k1)),
    { verified: false, reason: "high_s_signature" }
  );
  assert.deepEqual(
    verifyWith({ ...p256, sig: flipToHighS(p256.sig as string, P256_ORDER) }, didDoc(KEYS.p256)),
    { verified: false, reason: "high_s_signature" }
  );
});

test("rejects malformed signatures", () => {
  const base = signed("secp256k1");
  const sigBytes = Buffer.from(base.sig as string, "base64");
  const cases: unknown[] = [
    undefined,
    null,
    42,
    "",
    "not base64!",
    sigBytes.subarray(0, 63).toString("base64"),
    Buffer.concat([sigBytes, Buffer.from([0])]).toString("base64"),
    new Uint8Array(65),
    new Uint8Array(0),
    { $bytes: 5 },
    { $bytes: base.sig, extra: 1 },
    "A".repeat(500)
  ];
  for (const sig of cases) {
    assert.deepEqual(verifyWith({ ...base, sig }, didDoc(KEYS.secp256k1)), { verified: false, reason: "malformed_signature" });
  }
  // An all-zero signature has s = 0 and r = 0, which the curve math must refuse.
  assert.equal(verifyWith({ ...base, sig: new Uint8Array(64) }, didDoc(KEYS.secp256k1)).verified, false);
});

test("rejects malformed labels without throwing", () => {
  const base = signed("secp256k1");
  const bad: unknown[] = [
    null,
    "label",
    [],
    { ...base, src: "not-a-did" },
    { ...base, src: 5 },
    { ...base, uri: "" },
    { ...base, val: undefined },
    { ...base, cid: "" },
    { ...base, neg: "yes" },
    { ...base, cts: "yesterday" },
    { ...base, cts: "2024-02-31T00:00:00Z" },
    { ...base, exp: "soon" },
    { ...base, ver: 1.5 },
    { ...base, ver: "1" },
    { ...base, extra: "field" },
    { ...base, val: "\ud800" },
    { ...base, val: "x".repeat(9_000) }
  ];
  for (const label of bad) {
    assert.deepEqual(verifyWith(label, didDoc(KEYS.secp256k1)), { verified: false, reason: "malformed_label" }, JSON.stringify(label)?.slice(0, 60));
  }
  assert.deepEqual(verifyWith(new Proxy({}, { get() { throw new Error("hostile"); }, ownKeys() { throw new Error("hostile"); } }), didDoc(KEYS.secp256k1)).verified, false);
});

test("only version 1 verifies", () => {
  const base = signed("secp256k1");
  for (const ver of [0, 2, undefined]) {
    assert.deepEqual(verifyWith({ ...base, ver }, didDoc(KEYS.secp256k1)), { verified: false, reason: "unsupported_version" });
  }
});

test("expired labels do not verify as live, and the boundary is exclusive", () => {
  const base = signed("secp256k1"); // exp 2030-01-01T00:00:00.000Z
  assert.equal(verifyWith(base, didDoc(KEYS.secp256k1), "2029-12-31T23:59:59.999Z").verified, true);
  assert.deepEqual(verifyWith(base, didDoc(KEYS.secp256k1), "2030-01-01T00:00:00.000Z"), { verified: false, reason: "expired" });
  assert.deepEqual(verifyWith(base, didDoc(KEYS.secp256k1), "2031-01-01T00:00:00Z"), { verified: false, reason: "expired" });
  // A forged label stays signature_mismatch even when it is also past its expiry.
  assert.deepEqual(
    verifyWith({ ...base, val: "other" }, didDoc(KEYS.secp256k1), "2031-01-01T00:00:00Z"),
    { verified: false, reason: "signature_mismatch" }
  );
});

test("negation labels verify as negated, never as positive", () => {
  const negation = SIGNED_LABELS.secp256k1[2]!;
  assert.equal(negation.label.neg, true);
  const result = verifyWith(signed("secp256k1", 2), didDoc(KEYS.secp256k1));
  assert.deepEqual(result, { verified: true, keyType: "secp256k1", negated: true, hasExpiry: false });
  const positive = verifyWith(signed("secp256k1", 1), didDoc(KEYS.secp256k1));
  assert.equal(positive.verified && positive.negated, false);
  // Dropping neg from a signed negation changes the signed bytes, so it cannot turn it positive.
  const stripped = { ...signed("secp256k1", 2) };
  delete stripped.neg;
  assert.equal(verifyWith(stripped, didDoc(KEYS.secp256k1)).verified, false);
});

test("rejects an unusable clock", () => {
  for (const now of ["", "tomorrow", "2026-13-01T00:00:00Z", undefined as unknown as string]) {
    const result = verifyRecommendationAtprotoLabelSignature({ label: signed("secp256k1"), didDocument: didDoc(KEYS.secp256k1), now });
    assert.deepEqual(result, { verified: false, reason: "invalid_clock" });
  }
});

test("key resolution fails closed", () => {
  const label = signed("secp256k1");
  const key = KEYS.secp256k1;
  const method = { id: `${LABELER}#atproto_label`, type: "Multikey", controller: LABELER, publicKeyMultibase: key };
  const cases: Array<[unknown, string]> = [
    [undefined, "did_mismatch"],
    [null, "did_mismatch"],
    ["did", "did_mismatch"],
    [{ id: "did:plc:other", verificationMethod: [method] }, "did_mismatch"],
    [{ id: LABELER }, "key_not_found"],
    [{ id: LABELER, verificationMethod: "nope" }, "key_not_found"],
    [{ id: LABELER, verificationMethod: [] }, "key_not_found"],
    // The repo signing key is not a fallback for label signatures.
    [{ id: LABELER, verificationMethod: [{ ...method, id: `${LABELER}#atproto` }] }, "key_not_found"],
    [{ id: LABELER, verificationMethod: [{ ...method, id: "did:plc:other#atproto_label" }] }, "key_not_found"],
    [{ id: LABELER, verificationMethod: [method, { ...method, id: "#atproto_label" }] }, "ambiguous_key"],
    [{ id: LABELER, verificationMethod: [{ ...method, type: "JsonWebKey2020" }] }, "unsupported_key_type"],
    [{ id: LABELER, verificationMethod: [{ ...method, controller: "did:plc:other" }] }, "malformed_key"],
    [{ id: LABELER, verificationMethod: new Array(100).fill(method) }, "key_not_found"]
  ];
  for (const [doc, reason] of cases) {
    assert.deepEqual(verifyWith(label, doc), { verified: false, reason: reason as never }, reason);
  }
  // A relative method id is accepted, as resolvers often return it that way.
  assert.equal(verifyWith(label, { id: LABELER, verificationMethod: [{ ...method, id: "#atproto_label" }] }).verified, true);
});

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  for (; value > 0n; value /= 58n) out = alphabet[Number(value % 58n)] + out;
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

test("malformed multikeys are rejected", () => {
  const label = signed("secp256k1");
  const good = KEYS.secp256k1;
  const decodedGood = (() => {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n;
    for (const c of good.slice(1)) n = n * 58n + BigInt(alphabet.indexOf(c));
    return Uint8Array.from(Buffer.from(n.toString(16).padStart(70, "0"), "hex"));
  })();
  assert.equal(decodedGood.length, 35);

  const withPoint = (prefix: number[], point: number[]) => `z${base58(Uint8Array.from([...prefix, ...point]))}`;
  const goodPoint = [...decodedGood.subarray(2)];
  const offCurve = [0x02, ...new Array<number>(31).fill(0), 5]; // x = 5 has no y on secp256k1
  const xAtP = [0x02, ...Buffer.from("fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f", "hex")];
  assert.equal(offCurve.length, 33);

  const cases: Array<[unknown, string]> = [
    [undefined, "malformed_key"],
    [5, "malformed_key"],
    ["", "malformed_key"],
    ["z", "unsupported_key_type"],
    [good.slice(1), "malformed_key"], // missing the multibase prefix
    [`u${good.slice(1)}`, "malformed_key"], // base64url multibase is not allowed
    [`z${good.slice(1)}0`, "malformed_key"], // 0 is not in the base58 alphabet
    [`z${good.slice(1)}l`, "malformed_key"], // l is not in the base58 alphabet
    [`z${good.slice(1)}${good.slice(1)}`, "unsupported_key_type"], // doubled, so the prefix no longer matches
    [`z${"1".repeat(200)}`, "malformed_key"],
    [withPoint([0x12, 0x00], goodPoint), "unsupported_key_type"], // ed25519-ish prefix
    [withPoint([0xed, 0x01], goodPoint), "unsupported_key_type"],
    [withPoint([0xe7, 0x81, 0x00], goodPoint), "unsupported_key_type"], // overlong varint
    [withPoint([0xe7, 0x01], goodPoint.slice(0, 32)), "malformed_key"],
    [withPoint([0xe7, 0x01], [...goodPoint, 0]), "malformed_key"],
    [withPoint([0xe7, 0x01], [0x04, ...goodPoint.slice(1)]), "malformed_key"], // uncompressed marker
    [withPoint([0xe7, 0x01], [0x00, ...goodPoint.slice(1)]), "malformed_key"],
    [withPoint([0xe7, 0x01], offCurve), "malformed_key"],
    [withPoint([0xe7, 0x01], xAtP), "malformed_key"],
    [withPoint([0xe7, 0x01], new Array<number>(33).fill(0xff)), "malformed_key"],
    // x = 1 has no matching y on P-256.
    [withPoint([0x80, 0x24], [0x02, ...new Array<number>(31).fill(0), 1]), "malformed_key"]
  ];
  for (const [multibase, reason] of cases) {
    const result = verifyWith(label, didDoc(multibase as string));
    assert.deepEqual(result, { verified: false, reason: reason as never }, String(multibase).slice(0, 40));
  }
});

test("key rotation: only the key in the current DID document counts", () => {
  const oldKey = KEYS.secp256k1;
  const newKey = KEYS.p256;
  const signedByOld = signed("secp256k1");
  const signedByNew = signed("p256");

  const before = didDoc(oldKey);
  const after = didDoc(newKey);
  assert.equal(verifyWith(signedByOld, before).verified, true);
  assert.deepEqual(verifyWith(signedByOld, after), { verified: false, reason: "signature_mismatch" });
  assert.equal(verifyWith(signedByNew, after).verified, true);
  assert.deepEqual(verifyWith(signedByNew, before), { verified: false, reason: "signature_mismatch" });

  // Listing both keys under the label id is ambiguous, so neither signature is trusted.
  const both = {
    id: LABELER,
    verificationMethod: [
      { id: `${LABELER}#atproto_label`, type: "Multikey", publicKeyMultibase: oldKey },
      { id: `${LABELER}#atproto_label`, type: "Multikey", publicKeyMultibase: newKey }
    ]
  };
  assert.deepEqual(verifyWith(signedByOld, both), { verified: false, reason: "ambiguous_key" });
  assert.deepEqual(verifyWith(signedByNew, both), { verified: false, reason: "ambiguous_key" });
});

test("a label dated after the caller's clock is refused, with a small allowance for skew", () => {
  const base = signed("secp256k1"); // cts 2024-01-02T03:04:05.000Z
  const doc = didDoc(KEYS.secp256k1);
  assert.equal(verifyWith(base, doc, "2024-01-02T02:59:05.000Z").verified, true); // 5 minutes ahead exactly
  assert.deepEqual(verifyWith(base, doc, "2024-01-02T02:59:04.999Z"), { verified: false, reason: "future_label" });
  assert.deepEqual(verifyWith(base, doc, "2023-01-01T00:00:00Z"), { verified: false, reason: "future_label" });
  // A forged label does not get to learn anything about its date.
  assert.deepEqual(verifyWith({ ...base, val: "other" }, doc, "2023-01-01T00:00:00Z"), { verified: false, reason: "signature_mismatch" });
});
