import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationBlueskyProfileFeatureCapabilities,
  createRecommendationMastodonProfileFeatureCapabilities,
  normalizeRecommendationProfileFeatureCapabilities
} from "../src/index.js";

test("platform presets do not collapse protocol and application capabilities", () => {
  assert.deepEqual(createRecommendationMastodonProfileFeatureCapabilities(), {
    protocol: "activitypub",
    rawProfileText: "supported",
    pinnedPosts: "supported",
    discoverabilityControl: "supported",
    indexabilityControl: "supported",
    noindexSignal: "supported",
    featuredHashtags: "supported"
  });
  assert.deepEqual(createRecommendationBlueskyProfileFeatureCapabilities(), {
    protocol: "atproto",
    rawProfileText: "supported",
    pinnedPosts: "supported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "unsupported"
  });
});

test("custom provider capability manifests are runtime normalized and frozen", () => {
  const capabilities = normalizeRecommendationProfileFeatureCapabilities({
    protocol: "activitypub",
    rawProfileText: "supported",
    pinnedPosts: "unsupported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unknown",
    noindexSignal: "unsupported",
    featuredHashtags: "supported"
  });
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(capabilities.indexabilityControl, "unknown");
});

test("capability manifests reject unknown fields and invalid support states", () => {
  const base = {
    protocol: "atproto",
    rawProfileText: "supported",
    pinnedPosts: "supported",
    discoverabilityControl: "unsupported",
    indexabilityControl: "unsupported",
    noindexSignal: "unsupported",
    featuredHashtags: "unsupported"
  } as const;
  assert.throws(
    () => normalizeRecommendationProfileFeatureCapabilities({ ...base, featuredHashtags: "maybe" }),
    /feature support state/u
  );
  assert.throws(
    () => normalizeRecommendationProfileFeatureCapabilities({ ...base, mastodon: true }),
    /feature capabilities/u
  );
});
