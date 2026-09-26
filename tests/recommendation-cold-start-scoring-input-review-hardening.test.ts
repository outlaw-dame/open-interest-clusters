import test from "node:test";
import assert from "node:assert/strict";

import {
  buildColdStartScoringInput,
  createRecommendationCandidateId,
  createRecommendationEmbeddingSourceFingerprint,
  type RecommendationCandidate,
  type RecommendationColdStartGeneratedCandidate,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-09-25T00:00:00.000Z";
const PROFILE: RecommendationProfileSnapshot = {
  schemaVersion: "recommendation-profile.v1",
  updatedAt: NOW,
  signalCount: 0,
  entries: []
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
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "native",
      observedAt: NOW,
      trustBoundary: "same_provider"
    }]
  };
}

function generated(nativeId: string): RecommendationColdStartGeneratedCandidate {
  return {
    candidate: candidate(nativeId),
    match: {
      canonicalInterestIds: [],
      tags: [],
      entityIds: [],
      matchedProfileTargets: [],
      profileAffinityWeight: 0.5,
      languageCompatibility: "compatible",
      matchedLanguages: ["en"]
    }
  };
}

function bound(item: RecommendationColdStartGeneratedCandidate) {
  return {
    generated: item,
    eligibility: {
      candidate: item.candidate,
      eligible: true as const,
      reasonCodes: ["eligible" as const],
      evaluatedAt: NOW
    },
    profileFingerprint: createRecommendationEmbeddingSourceFingerprint(PROFILE)
  };
}

test("Phase 4 rejects eligibility bound to an older candidate snapshot with the same stable ID", async () => {
  const item = generated("did:plc:snapshot");
  const stale = { ...item.candidate, availability: "unavailable" as const };

  await assert.rejects(
    () => buildColdStartScoringInput({
      profile: PROFILE,
      candidates: [{
        ...bound(item),
        eligibility: { candidate: stale, eligible: true, reasonCodes: ["eligible"], evaluatedAt: NOW }
      }]
    }),
    /eligibility binding is stale/u
  );
});

test("Phase 4 bounds additive entity and graph enrichment", async () => {
  const item = generated("did:plc:bounds");

  await assert.rejects(
    () => buildColdStartScoringInput(
      { profile: PROFILE, candidates: [bound(item)] },
      { resolveFeatures: () => ({ graphBoost: 2 }) }
    ),
    /graph boost/u
  );

  await assert.rejects(
    () => buildColdStartScoringInput(
      { profile: PROFILE, candidates: [bound(item)] },
      {
        resolveFeatures: ({ candidateId }) => ({
          entityMatch: { clusterId: candidateId, score: 2, matchedEntityIds: [], relationHits: [] }
        })
      }
    ),
    /entity score/u
  );
});

test("Phase 4 workers stop taking new feature work and settle before resolver failure is returned", async () => {
  const items = Array.from({ length: 6 }, (_, index) => generated(`did:plc:failure-${index}`));
  let calls = 0;
  let inFlight = 0;

  await assert.rejects(
    () => buildColdStartScoringInput(
      { profile: PROFILE, candidates: items.map(bound) },
      {
        concurrency: 2,
        async resolveFeatures() {
          calls += 1;
          inFlight += 1;
          const call = calls;
          try {
            if (call === 1) throw new Error("resolver failed");
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {};
          } finally {
            inFlight -= 1;
          }
        }
      }
    ),
    /resolver failed/u
  );

  assert.equal(inFlight, 0);
  assert.ok(calls <= 2, `expected no new work after failure, received ${calls} resolver calls`);
});
