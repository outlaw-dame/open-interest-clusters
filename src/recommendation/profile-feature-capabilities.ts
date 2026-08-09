export const RECOMMENDATION_PROFILE_FEATURE_SUPPORT_STATES = [
  "supported",
  "unsupported",
  "unknown"
] as const;

export type RecommendationProfileFeatureSupport =
  typeof RECOMMENDATION_PROFILE_FEATURE_SUPPORT_STATES[number];
export type RecommendationProfileFeatureProtocol = "activitypub" | "atproto";

export interface RecommendationProfileFeatureCapabilities {
  protocol: RecommendationProfileFeatureProtocol;
  rawProfileText: RecommendationProfileFeatureSupport;
  pinnedPosts: RecommendationProfileFeatureSupport;
  discoverabilityControl: RecommendationProfileFeatureSupport;
  indexabilityControl: RecommendationProfileFeatureSupport;
  noindexSignal: RecommendationProfileFeatureSupport;
  featuredHashtags: RecommendationProfileFeatureSupport;
}

const SUPPORT_SET = new Set<string>(RECOMMENDATION_PROFILE_FEATURE_SUPPORT_STATES);
const CAPABILITY_KEYS = new Set([
  "protocol",
  "rawProfileText",
  "pinnedPosts",
  "discoverabilityControl",
  "indexabilityControl",
  "noindexSignal",
  "featuredHashtags"
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function support(value: unknown): RecommendationProfileFeatureSupport {
  if (typeof value !== "string" || !SUPPORT_SET.has(value)) {
    throw new TypeError("Invalid recommendation profile feature support state.");
  }
  return value as RecommendationProfileFeatureSupport;
}

export function normalizeRecommendationProfileFeatureCapabilities(
  value: unknown
): RecommendationProfileFeatureCapabilities {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !CAPABILITY_KEYS.has(key)) ||
    (value.protocol !== "activitypub" && value.protocol !== "atproto")
  ) {
    throw new TypeError("Invalid recommendation profile feature capabilities.");
  }
  return Object.freeze({
    protocol: value.protocol,
    rawProfileText: support(value.rawProfileText),
    pinnedPosts: support(value.pinnedPosts),
    discoverabilityControl: support(value.discoverabilityControl),
    indexabilityControl: support(value.indexabilityControl),
    noindexSignal: support(value.noindexSignal),
    featuredHashtags: support(value.featuredHashtags)
  });
}

/**
 * Convenience preset for the Mastodon account/profile API surface currently
 * supported by this package. Generic ActivityPub implementations must declare
 * their own capabilities instead of inheriting this preset.
 */
export function createRecommendationMastodonProfileFeatureCapabilities(): RecommendationProfileFeatureCapabilities {
  return Object.freeze({
    protocol: "activitypub",
    rawProfileText: "supported",
    pinnedPosts: "supported",
    discoverabilityControl: "supported",
    indexabilityControl: "supported",
    noindexSignal: "supported",
    featuredHashtags: "supported"
  });
}

/**
 * Convenience preset for the current app.bsky.actor.profile surface. Generic
 * ATProto applications must declare their own capabilities because app
 * lexicons can expose a different feature set.
 */
export function createRecommendationBlueskyProfileFeatureCapabilities(): RecommendationProfileFeatureCapabilities {
  return Object.freeze({
    protocol: "atproto",
    rawProfileText: "supported",
    pinnedPosts: "supported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "unsupported"
  });
}
