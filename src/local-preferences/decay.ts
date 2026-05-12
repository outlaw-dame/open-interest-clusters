import { decayBanditState } from "../scoring/bandit.js";
import type { LocalPreferenceProfile } from "./types.js";

export interface DecayLocalPreferenceOptions {
  now?: number;
  interestHalfLifeMs?: number;
  banditHalfLifeMs?: number;
  pruneBelowWeight?: number;
}

const DEFAULT_INTEREST_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 90;
const DEFAULT_BANDIT_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 30;
const DEFAULT_PRUNE_BELOW_WEIGHT = 0.01;

function decayValue(value: number, elapsedMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(value)) return 0;
  if (elapsedMs <= 0) return value;
  return value * Math.pow(0.5, elapsedMs / halfLifeMs);
}

export function decayLocalPreferenceProfile(
  profile: Readonly<LocalPreferenceProfile>,
  options: DecayLocalPreferenceOptions = {}
): LocalPreferenceProfile {
  const now = Math.max(profile.updatedAt, Math.floor(options.now ?? Date.now()));
  const interestHalfLifeMs = Math.max(1000, options.interestHalfLifeMs ?? DEFAULT_INTEREST_HALF_LIFE_MS);
  const banditHalfLifeMs = Math.max(1000, options.banditHalfLifeMs ?? DEFAULT_BANDIT_HALF_LIFE_MS);
  const pruneBelowWeight = Math.max(0, options.pruneBelowWeight ?? DEFAULT_PRUNE_BELOW_WEIGHT);

  const interests = profile.interests
    .map((interest) => {
      const elapsedMs = Math.max(0, now - interest.updatedAt);
      return {
        ...interest,
        weight: decayValue(interest.weight, elapsedMs, interestHalfLifeMs),
        updatedAt: now
      };
    })
    .filter((interest) => Math.abs(interest.weight) >= pruneBelowWeight)
    .sort((left, right) => right.weight - left.weight || left.clusterId.localeCompare(right.clusterId));

  const banditStates: LocalPreferenceProfile["banditStates"] = {};

  for (const [clusterId, state] of Object.entries(profile.banditStates)) {
    banditStates[clusterId] = decayBanditState(state, {
      now,
      halfLifeMs: banditHalfLifeMs
    });
  }

  return {
    ...profile,
    updatedAt: now,
    interests,
    banditStates
  };
}
