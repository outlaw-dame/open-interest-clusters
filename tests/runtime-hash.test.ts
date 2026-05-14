import test from "node:test";
import assert from "node:assert/strict";

import { sha256Fingerprint, sha256FingerprintAsync, sha256Hex, sha256HexAsync } from "../src/index.js";

const vectors = [
  {
    input: "",
    hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  {
    input: "abc",
    hex: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  },
  {
    input: "The quick brown fox jumps over the lazy dog",
    hex: "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
  },
  {
    input: "emoji: 🧠🚀",
    hex: "7a915555a4a63309c9bc2a678a633a1759a54134f90adfcc4d80638a9b66de7f"
  }
];

test("runtime sha256Hex matches known answer vectors", () => {
  for (const vector of vectors) {
    assert.equal(sha256Hex(vector.input), vector.hex);
  }
});

test("runtime sha256Fingerprint prefixes known answer hash", () => {
  assert.equal(
    sha256Fingerprint("abc"),
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("runtime async sha256 path matches sync path", async () => {
  for (const vector of vectors) {
    assert.equal(await sha256HexAsync(vector.input), sha256Hex(vector.input));
    assert.equal(await sha256FingerprintAsync(vector.input), sha256Fingerprint(vector.input));
  }
});
