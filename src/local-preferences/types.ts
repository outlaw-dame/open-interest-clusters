import type { FeedbackEventType, BanditArmState } from "../scoring/bandit.js";

export type LocalPreferenceSignalSource = "explicit" | "feedback" | "session" | "imported";

export interface LocalInterestWeight {
  clusterId: string;
  weight: number;
  source: LocalPreferenceSignalSource;
  updatedAt: number;
}

export interface LocalFeedbackEvent {
  clusterId: string;
  eventType: FeedbackEventType;
  occurredAt: number;
  source?: LocalPreferenceSignalSource;
}

export interface LocalPreferenceProfile {
  schemaVersion: "local-preference-profile.v1";
  createdAt: number;
  updatedAt: number;
  interests: LocalInterestWeight[];
  banditStates: Record<string, BanditArmState>;
}

export interface LocalPreferenceExplanation {
  clusterId: string;
  weight: number;
  banditScore: number;
  reason: "explicit_interest" | "local_feedback" | "combined" | "neutral";
}
