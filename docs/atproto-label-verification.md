# ATProto label signature verification

`verifyRecommendationAtprotoLabelSignature` checks that a labeler signed a `com.atproto.label.defs#label`. It is optional. Nothing in the core recommendation path calls it, and it adds no dependency.

## Can Node verify ATProto signatures on its own?

Yes. The earlier note that Node built-ins lack secp256k1 was wrong, and it had not been tested.

Experiment, run with Node v22.23.4 (OpenSSL 3.5.9), using only `node:crypto`:

- `createPublicKey` accepts a JWK with `crv: "secp256k1"` and with `crv: "P-256"`. It does not take a compressed point directly, so the verifier decompresses it with BigInt math (`y = (x^3 + ax + b)^((p+1)/4) mod p`, check `y^2`, pick the parity from the 02/03 prefix) and builds the JWK.
- `verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig)` verifies the raw 64 byte `r || s` form that ATProto uses.
- OpenSSL does not enforce low-S. With the check removed, the two high-S fixtures verified as valid. ATProto requires low-S, so the verifier compares `s` with `n / 2` itself.
- DER signatures (70 and 71 bytes in the fixtures) are refused by the length check.

Vectors: [bluesky-social/atproto-interop-tests](https://github.com/bluesky-social/atproto-interop-tests), `crypto/signature-fixtures.json`. The file was last changed in commit `94186876e41ab41cf93a0e051322ffbdd82dad9f`, and the repo's `main` was at `056e5741bb330757205d6b16db5266fffcae937b` when fetched. All six fixtures (valid and high-S and DER, for both curves) gave the expected result. Those fixtures sign an arbitrary message, not a label, so they were used for this experiment and are not copied into the test suite.

The package declares `node >= 20.11`. Node 20 ships OpenSSL 3 with the same secp256k1 support, but only Node 22 was run here.

## What the verifier does

1. Validates the label shape. Unknown fields, bad timestamps, bad types and `ver` other than 1 are refused.
2. Takes the caller's DID document. The document `id` must equal the label `src`. It needs exactly one verification method with id `#atproto_label` (or `<did>#atproto_label`), type `Multikey`, and a `controller` equal to the DID if one is given. There is no fallback to the repo signing key.
3. Decodes `publicKeyMultibase`: `z` plus base58btc, multicodec prefix `e7 01` (secp256k1) or `80 24` (P-256), then a 33 byte compressed point. Uncompressed points, other key types, `x >= p`, off-curve points and wrong lengths are refused.
4. Encodes the label without `sig` as DAG-CBOR: one map, keys sorted by length then bytewise, definite lengths, shortest integers, no floats or tags, strings checked for well-formed Unicode and bounded to 8 KiB.
5. Rejects `s > n / 2`, then verifies the signature over the SHA-256 of those bytes.
6. Only after the signature is good, rejects a label whose `exp` is at or before the injected `now`. A forged and expired label reports `signature_mismatch`, an authentic expired one reports `expired`.

7. Rejects a label whose `cts` is more than five minutes after `now` with `future_label`. This also runs after the signature check.

A verified negation returns `negated: true`. A caller must treat it as a retraction. A positive result only describes the one label you passed. It cannot tell you that the labeler signed a `neg` label for the same subject and value afterwards, so check the labeler's newer labels yourself before relying on a label with no `exp`.

The result is `{ verified: true, keyType, negated, hasExpiry }` or `{ verified: false, reason }`. Reasons are listed in `RECOMMENDATION_ATPROTO_LABEL_VERIFICATION_FAILURES`. Hostile input never throws.

The caller resolves the DID document and decides how fresh it must be. Key rotation works because only the key in the document you pass counts. A label signed by a retired key fails with `signature_mismatch`. Labels cached from before a rotation need a re-check against the new document.

## Turning a verified label into an attestation

`createRecommendationAtprotoLabelAttestation({ label, didDocument, now, subjectId, sourceIds, kind, claim, verifierId, evidence? })` runs the verification above and returns `{ issued: true, attestation }` or `{ issued: false, reason }`. It issues only when the signature verified. The attestation has mechanism `atproto_label_signature`, proof class `signature` and authority `protocol_native`, and `verifiedAt` is the `now` you passed.

- A signed negation is refused with `negated_label`. An attestation reads as a positive claim, and a retraction is not one. An expired label is refused with `expired`.
- A label with no `exp` stays attestable for as long as you keep passing it. Set `maxLabelAgeMs` to refuse a label whose `cts` is older than that (`label_too_old`). A non-positive or non-integer value gives `invalid_attestation_input`. It limits age only. It does not find a later negation.
- If the label has an `exp`, the attestation carries it as `expiresAt` and stops being accepted at that time, even inside `maxAgeMs`.
- The attestation always has a `contentDigest`. By default it is the digest of the label as given (including `sig`), so a verifier built with `bindContent: true` accepts only that exact label. Pass `evidence` to bind something derived from the label instead. You are then vouching for the derivation.
- A label with getters or non-plain values is refused (`malformed_label`) so that what was verified is what was digested. Bad subject, source, claim or verifier fields give `invalid_attestation_input`. The function does not throw.
- Wrong key, tampered label, bad clock and the other failures return the fixed reasons from verification and issue nothing.

Subject and source ids come from the caller and are not checked against the label. The evidence verifier matches them against what it derives from the evidence, so an attestation does not move to another subject or source set.

Nothing in the core imports `@atproto/*` or `@ipld/*`, and a test scans `package.json` and the compiled `dist/src` to keep it that way.

## How it was tested

- The encoder is compared with bytes produced by `@ipld/dag-cbor` 9.2.7, including integer and string length boundaries and multibyte text.
- The signed vectors in `tests/atproto-label-vectors.ts` were produced by `@atproto/crypto` 0.5.8 (`Secp256k1Keypair` and `P256Keypair`), and that library's `verifySignature` accepted each one. Both packages were installed in a scratch directory outside the repo. They are not dependencies.
- Tests cover tampering with each field, wrong key and other curve, flipped high-S, malformed signatures and keys, rotation, unsupported key types, expiry, negation and a bad clock.

Run with `pnpm test`.

## Not covered

- Repo, MST and CAR proof verification for ATProto records.
- ActivityPub HTTP signatures and Linked Data or object proof verification.
- Mastodon Collection REST reads stay origin attestations only. They are not signed and cannot satisfy a `signature` requirement.
- Fetching and caching DID documents.
