import test from "node:test";
import assert from "node:assert/strict";

import { applyDecay, normalizeScore } from "../src/scoring/reward-normalization.js";

test("clamps oversized values safely", () => {
  assert.equal(normalizeScore(100), 1);
  assert.equal(normalizeScore(-100), -1);
});

test("handles invalid values safely", () => {
  assert.equal(normalizeScore(Number.NaN), 0);
  assert.equal(normalizeScore(Number.POSITIVE_INFINITY), 0);
});

test("decays values within bounded range", () => {
  assert.equal(applyDecay(1, { decayFactor: 0.5 }), 0.5);
});
