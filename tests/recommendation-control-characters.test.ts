import test from "node:test";
import assert from "node:assert/strict";

import { hasUnsafeControlCharacter } from "../src/recommendation/control-characters.js";

const UNSAFE_CHARACTER_RANGES = Object.freeze([
  { name: "C0 control characters", start: 0x00, end: 0x1f },
  { name: "C1 control characters", start: 0x80, end: 0x9f }
]);

for (const { name, start, end } of UNSAFE_CHARACTER_RANGES) {
  test(`hasUnsafeControlCharacter rejects ${name}`, () => {
    for (let code = start; code <= end; code += 1) {
      assert.equal(
        hasUnsafeControlCharacter(`safe${String.fromCharCode(code)}value`),
        true,
        `expected U+${code.toString(16).padStart(4, "0").toUpperCase()} to be unsafe`
      );
    }
  });
}

test("hasUnsafeControlCharacter rejects DEL", () => {
  assert.equal(hasUnsafeControlCharacter(`safe${String.fromCharCode(0x7f)}value`), true);
});

test("hasUnsafeControlCharacter allows printable text and non-control unicode", async (t) => {
  await t.test("allows plain ASCII text", () => {
    assert.equal(hasUnsafeControlCharacter("plain ascii text"), false);
  });

  await t.test("allows emoji and accented characters", () => {
    assert.equal(hasUnsafeControlCharacter("emoji 🧠 and accents café"), false);
  });

  await t.test("allows unicode separators", () => {
    assert.equal(hasUnsafeControlCharacter("line separator \u2028 paragraph separator \u2029"), false);
  });
});
