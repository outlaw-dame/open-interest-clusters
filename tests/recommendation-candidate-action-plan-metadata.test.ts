import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationCandidateActionPlan,
  createRecommendationCandidateId,
  type RecommendationCandidate,
  type RecommendationCandidateEligibilityResult
} from "../src/index.js";

const OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const EVALUATED_AT = "2026-09-26T06:01:00.000Z";
const CREATED_AT = "2026-09-26T06:02:00.000Z";

function account(summary: string): RecommendationCandidate {
  const kind = "account" as const;
  const protocol = "activitypub" as const;
  const nativeId = "https://example.test/users/alice";
  const provider = "example.test";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification: { state: "authority_verified", authority: nativeId, verifiedAt: OBSERVED_AT },
    availability: "available",
    observedAt: OBSERVED_AT,
    metadata: { summary, canonicalInterestIds: ["gaming"], tags: ["gaming"], entityIds: [], languages: ["en"] },
    provenance: [{ kind: "provider_discovery", sourceId: "provider", observedAt: OBSERVED_AT, trustBoundary: "same_provider" }]
  };
}

function eligible(candidate: RecommendationCandidate): RecommendationCandidateEligibilityResult {
  return { candidate, eligible: true, reasonCodes: ["eligible"], evaluatedAt: EVALUATED_AT };
}

test("Phase 6 rejects changed candidate metadata even when stable identity fields match", () => {
  const current = account("current profile");
  const evaluated = account("older profile");
  assert.throws(
    () => createRecommendationCandidateActionPlan({ candidate: current, eligibility: eligible(evaluated), createdAt: CREATED_AT }),
    /exact candidate snapshot/u
  );
});
