import { applyDecay, normalizeScore } from "../reward-normalization.js";

describe("normalizeScore", () => {
  it("clamps oversized values safely", () => {
    expect(normalizeScore(100)).toBe(1);
    expect(normalizeScore(-100)).toBe(-1);
  });

  it("handles invalid values safely", () => {
    expect(normalizeScore(Number.NaN)).toBe(0);
    expect(normalizeScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("applyDecay", () => {
  it("decays values within bounded range", () => {
    expect(applyDecay(1, { decayFactor: 0.5 })).toBe(0.5);
  });
});
