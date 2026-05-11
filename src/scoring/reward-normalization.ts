export interface RewardNormalizationOptions {
  minValue?: number;
  maxValue?: number;
  decayFactor?: number;
}

const DEFAULT_MIN = -5;
const DEFAULT_MAX = 5;
const DEFAULT_DECAY = 0.95;

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value ?? fallback));
}

export function normalizeScore(
  value: number,
  options: RewardNormalizationOptions = {}
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  let min = boundedNumber(options.minValue, DEFAULT_MIN, -1_000, 0);
  let max = boundedNumber(options.maxValue, DEFAULT_MAX, 0, 1_000);

  if (min === max) {
    min = DEFAULT_MIN;
    max = DEFAULT_MAX;
  }

  const clamped = Math.min(max, Math.max(min, value));
  const denominator = Math.max(Math.abs(min), Math.abs(max), 1);

  return clamped / denominator;
}

export function applyDecay(
  value: number,
  options: RewardNormalizationOptions = {}
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const decay = boundedNumber(options.decayFactor, DEFAULT_DECAY, 0, 1);
  const decayed = value * decay;

  return Number.isFinite(decayed) ? decayed : 0;
}
