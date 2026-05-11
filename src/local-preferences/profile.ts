import {
  applyFeedbackEvent,
  createBanditArmState,
  scoreBanditState,
  type BanditArmState
} from "../scoring/bandit.js";

import type {
  LocalFeedbackEvent,
  LocalInterestWeight,
  LocalPreferenceExplanation,
  LocalPreferenceProfile
} from "./types.js";

const MAX_INTEREST_WEIGHT = 100;
const MIN_INTEREST_WEIGHT = -100;
const DEFAULT_EXPLICIT_WEIGHT = 25;
const MAX_INTERESTS = 10_000;

function clampWeight(value: number): number {
  return Math.max(MIN_INTEREST_WEIGHT, Math.min(MAX_INTEREST_WEIGHT, value));
}

function normalizeInterest(interest: LocalInterestWeight): LocalInterestWeight {
  return {
    ...interest,
    weight: clampWeight(interest.weight)
  };
}

export function createLocalPreferenceProfile(now = Date.now()): LocalPreferenceProfile {
  return {
    schemaVersion: "local-preference-profile.v1",
    createdAt: now,
    updatedAt: now,
    interests: [],
    banditStates: {}
  };
}

export function addExplicitInterest(
  profile: Readonly<LocalPreferenceProfile>,
  clusterId: string,
  now = Date.now()
): LocalPreferenceProfile {
  const interests = new Map(
    profile.interests.map((interest) => [interest.clusterId, normalizeInterest(interest)])
  );

  const existing = interests.get(clusterId);

  interests.set(clusterId, {
    clusterId,
    weight: clampWeight((existing?.weight ?? 0) + DEFAULT_EXPLICIT_WEIGHT),
    source: "explicit",
    updatedAt: now
  });

  const next = Array.from(interests.values())
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_INTERESTS);

  return {
    ...profile,
    updatedAt: now,
    interests: next
  };
}

export function applyLocalFeedback(
  profile: Readonly<LocalPreferenceProfile>,
  feedback: LocalFeedbackEvent
): LocalPreferenceProfile {
  const existing = profile.banditStates[feedback.clusterId] ?? createBanditArmState(feedback.occurredAt);

  const updatedState = applyFeedbackEvent(
    existing,
    feedback.eventType,
    {
      now: feedback.occurredAt
    }
  );

  return {
    ...profile,
    updatedAt: feedback.occurredAt,
    banditStates: {
      ...profile.banditStates,
      [feedback.clusterId]: updatedState
    }
  };
}

export function scoreLocalPreference(
  profile: Readonly<LocalPreferenceProfile>,
  clusterId: string
): LocalPreferenceExplanation {
  const interest = profile.interests.find((entry) => entry.clusterId === clusterId);
  const state: BanditArmState | undefined = profile.banditStates[clusterId];

  const banditScore = state
    ? scoreBanditState(state, 100)
    : 0;

  const weight = clampWeight((interest?.weight ?? 0) + banditScore * 10);

  let reason: LocalPreferenceExplanation["reason"] = "neutral";

  if (interest && state) {
    reason = "combined";
  } else if (interest) {
    reason = "explicit_interest";
  } else if (state) {
    reason = "local_feedback";
  }

  return {
    clusterId,
    weight,
    banditScore,
    reason
  };
}
