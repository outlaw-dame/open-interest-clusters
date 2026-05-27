import test from "node:test";
import assert from "node:assert/strict";

import { hasUnsafeControlCharacter } from "../src/recommendation/control-characters.js";

test("hasUnsafeControlCharacter rejects C0 control characters", () => {
  for (let code = 0x00; code <= 0x1f; code += 1) {
    assert.equal(
      hasUnsafeControlCharacter(`safe${String.fromCharCode(code)}value`),
      true,
      `expected U+${code.toString(16).padStart(4, "0").toUpperCase()} to be unsafe`
    );
  }
});

test("hasUnsafeControlCharacter rejects DEL", () => {
  assert.equal(hasUnsafeControlCharacter(`safe${String.fromCharCode(0x7f)}value`), true);
});

test("hasUnsafeControlCharacter rejects C1 control characters", () => {
  for (let code = 0x80; code <= 0x9f; code += 1) {
    assert.equal(
      hasUnsafeControlCharacter(`safe${String.fromCharCode(code)}value`),
      true,
      `expected U+${code.toString(16).padStart(4, "0").toUpperCase()} to be unsafe`
    );
  }
});

test("hasUnsafeControlCharacter allows printable text and non-control unicode", () => {
  assert.equal(hasUnsafeControlCharacter("plain ascii text"), false);
  assert.equal(hasUnsafeControlCharacter("emoji 🧠 and accents café"), false);
  assert.equal(hasUnsafeControlCharacter("line separator \u2028 paragraph separator \u2029"), false);
});
