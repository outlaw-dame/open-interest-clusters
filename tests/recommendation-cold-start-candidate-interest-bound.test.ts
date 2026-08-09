import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRecommendationColdStartCandidates,
  type RecommendationCandidateSourceAdapter,
  type RecommendationProfileEntry,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-08-09T10:00:00.000Z";

function entry(index: number): RecommendationProfileEntry {
  const stronger = index < 256;
  return {
    target: { kind: "canonical_interest", key: `interest.${String(index).padStart(3, "0")}` },
    score: stronger ? 1 : 0.5,
    confidence: 1,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries: ["local_only"],
    protocols: ["app_local"],
    sourceVisibilities: ["local_only"],
    updatedAt: NOW
  };
}

test("cold-start source queries deterministically cap canonical interests at the contract bound", async () => {
  const entries = Array.from({ length: 257 }, (_, index) => entry(index));
  const profile: RecommendationProfileSnapshot = {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: NOW,
    signalCount: entries.length,
    entries
  };
  let seen: readonly string[] | undefined;
  const source: RecommendationCandidateSourceAdapter = {
    id: "interest-bound.local",
    protocols: ["activitypub"],
    candidateKinds: ["account"],
    authority: "curated_public",
    transport: "local",
    privacy: {
      sourceVisibility: "local_only",
      accessBasis: "owner",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities: ["discover", "returns_public_metadata"],
    read(query) {
      seen = query.canonicalInterestIds;
      return { candidates: [] };
    }
  };

  const result = await generateRecommendationColdStartCandidates({
    requestId: "interest-bound",
    profile,
    sources: [source],
    candidateKinds: ["account"]
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.successfulSourceCount, 1);
  assert.equal(seen?.length, 256);
  assert.equal(seen?.includes("interest.256"), false);
  assert.equal(seen?.[0], "interest.000");
  assert.equal(seen?.[255], "interest.255");
});
