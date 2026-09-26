import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendationCandidateActionPlan, createRecommendationCandidateId, type RecommendationCandidate, type RecommendationCandidateEligibilityResult } from "../src/index.js";

const candidate: RecommendationCandidate = {
  candidateId: createRecommendationCandidateId({ kind: "account", protocol: "activitypub", nativeId: "https://example.test/users/alice", provider: "example.test" }),
  kind: "account", protocol: "activitypub", nativeId: "https://example.test/users/alice", provider: "example.test",
  verification: { state: "authority_verified", authority: "https://example.test/users/alice", verifiedAt: "2026-09-26T06:00:00.000Z" },
  availability: "available", observedAt: "2026-09-26T06:00:00.000Z",
  metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: [] },
  provenance: [{ kind: "provider_discovery", sourceId: "provider", observedAt: "2026-09-26T06:00:00.000Z", trustBoundary: "same_provider" }]
};

test("Phase 6 rejects contradictory reason codes even when eligible is true", () => {
  const eligibility: RecommendationCandidateEligibilityResult = {
    candidate, eligible: true, reasonCodes: ["eligible", "candidate_unavailable"], evaluatedAt: "2026-09-26T06:01:00.000Z"
  };
  assert.throws(
    () => createRecommendationCandidateActionPlan({ candidate, eligibility, createdAt: "2026-09-26T06:02:00.000Z" }),
    /explicit eligible evidence/u
  );
});
