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
const MAX_CLUSTER_ID_LENGTH = 512;

function assertValidClusterId(clusterId: string): void {
  if (!clusterId || clusterId.length > MAX_CLUSTER_ID_LENGTH || /[\u0000-\u001F\u007F]/u.test(clusterId)) {
    throw new Error("Invalid local preference cluster id");
  }
}

function normalizeTimestamp(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(MIN_INTEREST_WEIGHT, Math.min(MAX_INTEREST_WEIGHT, value));
}

function normalizeInterest(interest: LocalInterestWeight): LocalInterestWeight {
  assertValidClusterId(interest.clusterId);

  return {
    ...interest,
    weight: clampWeight(interest.weight),
    updatedAt: normalizeTimestamp(interest.updatedAt, 0)
  };
}

export function createLocalPreferenceProfile(now = Date.now()): LocalPreferenceProfile {
  const timestamp = normalizeTimestamp(now, Date.now());

  return {
    schemaVersion: "local-preference-profile.v1",
    createdAt: timestamp,
    updatedAt: timestamp,
    interests: [],
    banditStates: {}
  };
}

export function addExplicitInterest(
  profile: Readonly<LocalPreferenceProfile>,
  clusterId: string,
  now = Date.now()
): LocalPreferenceProfile {
  assertValidClusterId(clusterId);

  const timestamp = Math.max(profile.updatedAt, normalizeTimestamp(now, profile.updatedAt));
  const interests = new Map(
    profile.interests.map((interest) => [interest.clusterId, normalizeInterest(interest)])
  );

  const existing = interests.get(clusterId);

  interests.set(clusterId, {
    clusterId,
    weight: clampWeight((existing?.weight ?? 0) + DEFAULT_EXPLICIT_WEIGHT),
    source: "explicit",
    updatedAt: timestamp
  });

  const next = Array.from(interests.values())
    .sort((left, right) => right.weight - left.weight || left.clusterId.localeCompare(right.clusterId))
    .slice(0, MAX_INTERESTS);

  return {
    ...profile,
    updatedAt: timestamp,
    interests: next
  };
}

export function applyLocalFeedback(
  profile: Readonly<LocalPreferenceProfile>,
  feedback: LocalFeedbackEvent
): LocalPreferenceProfile {
  assertValidClusterId(feedback.clusterId);

  const timestamp = Math.max(profile.updatedAt, normalizeTimestamp(feedback.occurredAt, profile.updatedAt));
  const existing = profile.banditStates[feedback.clusterId] ?? createBanditArmState(timestamp);

  const updatedState = applyFeedbackEvent(
    existing,
    feedback.eventType,
    {
      now: timestamp
    }
  );

  return {
    ...profile,
    updatedAt: timestamp,
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
  assertValidClusterId(clusterId);

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
