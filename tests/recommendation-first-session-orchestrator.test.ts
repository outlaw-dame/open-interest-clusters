import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationCandidateId,
  createRecommendationFirstSessionOrchestrator,
  type RecommendationCandidate,
  type RecommendationCandidateSourceAdapter,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-09-25T00:00:00.000Z";
const PROFILE: RecommendationProfileSnapshot = {
  schemaVersion: "recommendation-profile.v1",
  updatedAt: NOW,
  signalCount: 1,
  entries: [{
    target: { kind: "canonical_interest", key: "gaming.playstation" },
    score: 0.9,
    confidence: 0.9,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries: ["local_only"],
    protocols: ["app_local"],
    sourceVisibilities: ["local_only"],
    updatedAt: NOW
  }]
};

function candidate(nativeId: string): RecommendationCandidate {
  const kind = "account" as const;
  const protocol = "atproto" as const;
  const provider = "bsky.app";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: NOW },
    availability: "available",
    observedAt: NOW,
    metadata: {
      canonicalInterestIds: ["gaming.playstation"],
      tags: [],
      entityIds: [],
      languages: ["en"]
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "test-source",
      observedAt: NOW,
      trustBoundary: "same_provider"
    }]
  };
}

function source(items: readonly RecommendationCandidate[]): RecommendationCandidateSourceAdapter {
  return {
    id: "test-source",
    protocols: ["atproto"],
    candidateKinds: ["account"],
    authority: "provider_native",
    transport: "local",
    privacy: {
      sourceVisibility: "public",
      accessBasis: "public",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"],
    read: () => ({ candidates: items })
  };
}

test("Phase 5 composes discovery, eligibility, scoring, execution, and candidate-bound serving", async () => {
  const alice = candidate("did:plc:alice");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice])],
    candidateKinds: ["account"],
    evaluateEligibility: ({ candidate: generated }) => ({
      candidate: generated.candidate,
      eligible: true,
      reasonCodes: ["eligible"],
      evaluatedAt: NOW
    })
  });

  const result = await orchestrator.execute({
    subjectId: "local-user",
    requestId: "first-session-1",
    languages: ["en"],
    limit: 10
  });

  assert.equal(result.discoveredCandidateCount, 1);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.equal(result.eligibilityFailureCount, 0);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.candidate.candidateId, alice.candidateId);
  assert.equal(result.recommendations[0]?.rank, 1);
});

test("Phase 5 fails closed per candidate when eligibility evaluation fails", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice, bob])],
    candidateKinds: ["account"],
    evaluateEligibility: ({ candidate: generated }) => {
      if (generated.candidate.candidateId === alice.candidateId) throw new Error("provider lookup failed");
      return {
        candidate: generated.candidate,
        eligible: true,
        reasonCodes: ["eligible"],
        evaluatedAt: NOW
      };
    }
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-2" });
  assert.equal(result.discoveredCandidateCount, 2);
  assert.equal(result.eligibilityFailureCount, 1);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.equal(result.recommendations[0]?.candidate.candidateId, bob.candidateId);
});

test("Phase 5 propagates explicit cancellation instead of converting it to eligibility failure", async () => {
  const controller = new AbortController();
  const alice = candidate("did:plc:alice");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice])],
    candidateKinds: ["account"],
    evaluateEligibility: () => {
      controller.abort(new Error("cancelled"));
      throw new Error("resolver stopped");
    }
  });

  await assert.rejects(
    () => orchestrator.execute({
      subjectId: "local-user",
      requestId: "first-session-3",
      signal: controller.signal
    }),
    /cancelled/u
  );
});
