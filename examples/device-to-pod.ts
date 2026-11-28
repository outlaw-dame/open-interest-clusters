// Moving the stored profile between this device and a pod the user owns, and checking where a store may
// sit at all. The pod here is another in-memory adapter with the pod's manifest, not a live ActivityPods
// server. The move itself is the library's `transitionRecommendationProfilePersistence`.
import {
  evaluateRecommendationStateStorageManifest,
  transitionRecommendationProfilePersistence,
  type RecommendationCandidateEventStore,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfilePersistenceRetryOptions,
  type RecommendationProfilePersistenceTransitionResult,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";
import type { ReferenceOnboarding } from "./onboarding-flow.js";

export interface ReferenceStorageLocation {
  adapter: RecommendationProfilePersistenceAdapter;
  /** Where this location keeps reported candidate events. Events only move when both sides have a store. */
  candidateEventStore?: RecommendationCandidateEventStore;
}

export interface ReferenceMoveInput {
  onboarding: ReferenceOnboarding;
  device: ReferenceStorageLocation;
  pod: ReferenceStorageLocation;
  retry?: RecommendationProfilePersistenceRetryOptions;
}

function location(target: "local_app" | "user_pod", value: ReferenceStorageLocation) {
  return { adapter: value.adapter, storageTarget: target, ...(value.candidateEventStore === undefined ? {} : { candidateEventStore: value.candidateEventStore }) };
}

/**
 * Device to pod. Needs the user's server-side consent first (`allowServerSideProcessing`), because a pod
 * is a server even when the user owns it. The call is safe to repeat: if the last step failed it picks
 * up where it stopped. The selection target only changes once the move has finished.
 */
export async function moveProfileToPod(input: ReferenceMoveInput): Promise<RecommendationProfilePersistenceTransitionResult> {
  const result = await transitionRecommendationProfilePersistence({
    subjectId: input.onboarding.subjectId,
    from: location("local_app", input.device),
    to: location("user_pod", input.pod),
    policy: input.onboarding.policy(),
    ...(input.retry === undefined ? {} : { retry: input.retry })
  });
  input.onboarding.markMoved("activitypods_pod");
  return result;
}

/**
 * Pod back to the device. Needs no server-side consent, so no policy is passed. Passing a revoked
 * policy here would make the library refuse the move, even though it only brings data closer to the user.
 */
export async function moveProfileToDevice(input: ReferenceMoveInput): Promise<RecommendationProfilePersistenceTransitionResult> {
  const result = await transitionRecommendationProfilePersistence({
    subjectId: input.onboarding.subjectId,
    from: location("user_pod", input.pod),
    to: location("local_app", input.device),
    policy: null,
    ...(input.retry === undefined ? {} : { retry: input.retry })
  });
  input.onboarding.markMoved("local_app");
  return result;
}

export interface PlacementCheck {
  allowed: boolean;
  /** Reason codes from the placement policy, for the domains that were refused. */
  refusedBecause: readonly string[];
}

/**
 * Asks the placement policy whether a store may hold this subject's state. Provider-owned and
 * shared-operator stores are refused, and so is a store that says it is publicly readable, such as a
 * public ATProto repository. The library trusts the manifest, so an adapter author has to fill it in honestly.
 */
export function checkPlacement(manifest: RecommendationStateStorageAdapterManifest): PlacementCheck {
  const evaluation = evaluateRecommendationStateStorageManifest(manifest);
  const refusedBecause = evaluation.evaluations.filter((item) => item.decision === "deny").map((item) => item.reason);
  return { allowed: evaluation.decision === "allow", refusedBecause: [...new Set(refusedBecause)] };
}
