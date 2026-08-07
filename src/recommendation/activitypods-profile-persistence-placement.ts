import {
  createRecommendationActivityPodsProfilePersistenceAdapter as createBaseActivityPodsProfilePersistenceAdapter,
  type RecommendationActivityPodsProfilePersistenceAdapterInput
} from "./activitypods-profile-persistence-adapter.js";
import type { RecommendationProfilePersistenceAdapter } from "./profile-store-persistence.js";
import type { RecommendationStateStorageAdapterManifest } from "./state-placement-policy.js";

export const RECOMMENDATION_ACTIVITYPODS_PROFILE_STORAGE_MANIFEST: RecommendationStateStorageAdapterManifest =
  Object.freeze({
    adapterId: "activitypods-profile-persistence",
    domains: Object.freeze(["interest_profile"]),
    authority: "user_owned",
    processingBoundary: "server_allowed",
    persistence: "persistent",
    requiresNetwork: true,
    supportsOffline: false,
    userExportable: true,
    userDeletable: true,
    encryptedAtRest: false
  });

/**
 * Public ActivityPods profile adapter with an explicit user-controlled remote
 * placement manifest. Authorization and transport security remain enforced by
 * the underlying grant-bound adapter.
 */
export function createRecommendationActivityPodsProfilePersistenceAdapterWithManifest(
  input: RecommendationActivityPodsProfilePersistenceAdapterInput
): RecommendationProfilePersistenceAdapter {
  const adapter = createBaseActivityPodsProfilePersistenceAdapter(input);
  return Object.freeze({
    storageManifest: RECOMMENDATION_ACTIVITYPODS_PROFILE_STORAGE_MANIFEST,
    readProfileRecord: adapter.readProfileRecord,
    writeProfileRecord: adapter.writeProfileRecord,
    deleteProfileRecord: adapter.deleteProfileRecord
  });
}
