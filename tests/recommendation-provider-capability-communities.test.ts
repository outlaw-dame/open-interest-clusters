import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOMMENDATION_PROVIDER_CAPABILITIES,
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  normalizeRecommendationProviderDiscoveryObservation,
  type RecommendationCandidate,
  type RecommendationProviderDescriptor
} from "../src/index.js";
import { actionProvider } from "./recommendation-candidate-action-plan-fixtures.js";

const NOW = "2026-09-26T06:00:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";

function observationWith(capability: unknown): unknown {
  return {
    providerId: "provider.example",
    protocolBindings: [{ protocol: "activitypub", authority: "provider_probe", verification: "asserted" }],
    applicationProfiles: [],
    capabilities: [{ capability, state: "supported", authority: "provider_probe", protocol: "activitypub" }],
    observedAt: NOW,
    expiresAt: "2026-09-26T07:00:00.000Z"
  };
}

function communityCandidate(): RecommendationCandidate {
  const nativeId = "https://example.test/community/1";
  return {
    candidateId: createRecommendationCandidateId({ kind: "community", protocol: "activitypub", nativeId, provider: "example.test" }),
    kind: "community", protocol: "activitypub", nativeId, provider: "example.test",
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: NOW },
    availability: "available", observedAt: NOW,
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "test-source", observedAt: NOW, trustBoundary: "same_provider" }]
  };
}

test("the communities capability is part of the provider capability vocabulary", () => {
  assert.ok((RECOMMENDATION_PROVIDER_CAPABILITIES as readonly string[]).includes("communities"));
  assert.equal(normalizeRecommendationProviderDiscoveryObservation(observationWith("communities")).capabilities[0]?.capability, "communities");
});

test("the retired collections capability is rejected like any unknown value, not aliased", () => {
  assert.equal((RECOMMENDATION_PROVIDER_CAPABILITIES as readonly string[]).includes("collections"), false);
  assert.throws(() => normalizeRecommendationProviderDiscoveryObservation(observationWith("collections")), /Invalid recommendation provider capability observation\./u);
  assert.throws(() => normalizeRecommendationProviderDiscoveryObservation(observationWith("not_a_capability")), /Invalid recommendation provider capability observation\./u);
});

test("a community action plan needs communities and ignores a legacy collections capability", () => {
  const candidate = communityCandidate();
  const eligibility = { candidate, eligible: true as const, reasonCodes: ["eligible" as const], evaluatedAt: "2026-09-26T06:01:00.000Z" };
  const input = (provider: RecommendationProviderDescriptor) => ({ candidate, eligibility, provider, createdAt: CREATED_AT });
  assert.equal(createRecommendationCandidateActionPlan(input(actionProvider("community"))).action, "follow_community");
  const legacy = {
    ...actionProvider("community"),
    capabilities: [{ capability: "collections", state: "supported", authority: "protocol_native", protocol: "activitypub" }]
  } as unknown as RecommendationProviderDescriptor;
  assert.throws(() => createRecommendationCandidateActionPlan(input(legacy)), /supported provider action capability/u);
});
