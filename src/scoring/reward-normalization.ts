export interface RewardNormalizationOptions {
  minValue?: number;
  maxValue?: number;
  decayFactor?: number;
}

const DEFAULT_MIN = -5;
const DEFAULT_MAX = 5;
const DEFAULT_DECAY = 0.95;

export function normalizeScore(
  value: number,
  options: RewardNormalizationOptions = {}
): number {
  const min = options.minValue ?? DEFAULT_MIN;
  const max = options.maxValue ?? DEFAULT_MAX;

  if (!Number.isFinite(value)) {
    return 0;
  }

  const clamped = Math.min(max, Math.max(min, value));
  return clamped / Math.max(Math.abs(min), Math.abs(max), 1);
}

export function applyDecay(
  value: number,
  options: RewardNormalizationOptions = {}
): number {
  const decay = options.decayFactor ?? DEFAULT_DECAY;
  return value * Math.min(1, Math.max(0, decay));
}
