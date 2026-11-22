import type { RecommendationInterestPrivacyBoundary } from "./interest-signal.js";
import type { RecommendationProfileEntry, RecommendationProfileSnapshot } from "./profile-store.js";

/** The storage targets whose placement decides the label on a profile's interests. */
export type RecommendationProfilePrivacyLabelTarget = "local_app" | "user_pod";

/**
 * The label a profile's interests carry in a given placement. The label says where the interests are
 * processed: on the device they are `local_only`, in the user's own pod (a server, even if the user
 * controls it) they are `server_allowed`.
 */
export function privacyBoundaryForProfileTarget(target: RecommendationProfilePrivacyLabelTarget): RecommendationInterestPrivacyBoundary {
  return target === "user_pod" ? "server_allowed" : "local_only";
}

function relabelEntry(entry: RecommendationProfileEntry, from: RecommendationInterestPrivacyBoundary, to: RecommendationInterestPrivacyBoundary): RecommendationProfileEntry {
  if (!entry.privacyBoundaries.includes(from)) return entry;
  const boundaries = [...new Set(entry.privacyBoundaries.map((boundary) => boundary === from ? to : boundary))].sort();
  return Object.freeze({ ...entry, privacyBoundaries: Object.freeze(boundaries) });
}

/**
 * Returns the profile with its interests labelled for the target placement: `local_only` becomes
 * `server_allowed` for a pod, and `server_allowed` becomes `local_only` for the device. Nothing else
 * changes, not even the timestamps, so the result is deterministic and applying it twice gives the same
 * profile. A profile that already fits is returned as the same object, which lets callers tell whether
 * anything needed fixing. `aggregate_only` entries are left alone for the persistence checks to refuse.
 */
export function relabelRecommendationProfileForTarget(
  profile: RecommendationProfileSnapshot,
  target: RecommendationProfilePrivacyLabelTarget
): RecommendationProfileSnapshot {
  const to = privacyBoundaryForProfileTarget(target);
  const from: RecommendationInterestPrivacyBoundary = to === "server_allowed" ? "local_only" : "server_allowed";
  const entries = profile.entries.map((entry) => relabelEntry(entry, from, to));
  if (entries.every((entry, index) => entry === profile.entries[index])) return profile;
  return Object.freeze({ ...profile, entries: Object.freeze(entries) });
}
