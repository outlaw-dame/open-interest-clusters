import test from "node:test";
import assert from "node:assert/strict";

import {
  buildColdStartScoringInput,
  createRecommendationCandidateId,
  createRecommendationEmbeddingSourceFingerprint,
  type RecommendationCandidate,
  type RecommendationCandidateEligibilityResult,
  type RecommendationColdStartGeneratedCandidate,
  type RecommendationColdStartScoringCandidate,
  type RecommendationProfileEntry,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-09-25T00:00:00.000Z";

function profileEntry(
  kind: RecommendationProfileEntry["target"]["kind"],
  key: string,
  score: number,
  confidence: number
): RecommendationProfileEntry {
  return {
    target: { kind, key },
    score,
    confidence,
    signalCount: 1,
    positiveSignalCount: score > 0 ? 1 : 0,
    negativeSignalCount: score < 0 ? 1 : 0,
    neutralSignalCount: score === 0 ? 1 : 0,
    privacyBoundaries: ["local_only"],
    protocols: ["app_local"],
    sourceVisibilities: ["local_only"],
    updatedAt: NOW
  };
}

function profile(entries: readonly RecommendationProfileEntry[]): RecommendationProfileSnapshot {
  return {
    schemaVersion: "recommendation-profile.v1",
    updatedAt: NOW,
    signalCount: entries.reduce((total, entry) => total + entry.signalCount, 0),
    entries
  };
}

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
      tags: ["PlayStation"],
      entityIds: ["Q-playstation"],
      languages: ["en"]
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "native",
      observedAt: NOW,
      trustBoundary: "same_provider"
    }]
  };
}

function generated(nativeId = "did:plc:candidate"): RecommendationColdStartGeneratedCandidate {
  const item = candidate(nativeId);
  return {
    candidate: item,
    match: {
      canonicalInterestIds: ["gaming.playstation"],
      tags: ["PlayStation"],
      entityIds: ["Q-playstation"],
      matchedProfileTargets: [{
        kind: "canonical_interest",
        key: "gaming.playstation",
        weight: 0.81
      }],
      profileAffinityWeight: 0.81,
      languageCompatibility: "compatible",
      matchedLanguages: ["en"]
    }
  };
}

function eligible(item: RecommendationCandidate): RecommendationCandidateEligibilityResult {
  return {
    candidate: item,
    eligible: true,
    reasonCodes: ["eligible"],
    evaluatedAt: NOW
  };
}

function bound(
  p: RecommendationProfileSnapshot,
  item = generated()
): RecommendationColdStartScoringCandidate {
  return {
    generated: item,
    eligibility: eligible(item.candidate),
    profileFingerprint: createRecommendationEmbeddingSourceFingerprint(p)
  };
}

const PROFILE = profile([
  profileEntry("canonical_interest", "gaming.playstation", 0.9, 0.9)
]);

test("Phase 4 builds deterministic scoring input with reversible candidate identity binding", async () => {
  const item = generated();
  const result = await buildColdStartScoringInput({
    profile: PROFILE,
    candidates: [bound(PROFILE, item)]
  });

  assert.equal(result.scoringInput.deterministic?.has(item.candidate.candidateId), true);
  assert.equal(result.candidateByScoringId.get(item.candidate.candidateId), item.candidate);
  assert.equal(result.profileFingerprint.profileDigest.length, 64);
});

test("Phase 4 treats zero candidates and no optional enrichment as normal", async () => {
  const result = await buildColdStartScoringInput({ profile: PROFILE, candidates: [] });
  assert.equal(result.scoringInput.deterministic?.size, 0);
  assert.equal(result.scoringInput.entityMatches, undefined);
  assert.equal(result.scoringInput.graphBoost, undefined);
  assert.equal(result.scoringInput.embeddingSimilarity, undefined);
  assert.equal(result.candidateByScoringId.size, 0);
});

test("Phase 4 supports bounded entity, graph, and embedding enrichment", async () => {
  const item = generated();
  const result = await buildColdStartScoringInput(
    { profile: PROFILE, candidates: [bound(PROFILE, item)] },
    {
      async resolveFeatures(context) {
        assert.equal(context.candidateId, item.candidate.candidateId);
        return {
          entityMatch: {
            clusterId: context.candidateId,
            score: 0.4,
            matchedEntityIds: ["Q-playstation"],
            relationHits: []
          },
          graphBoost: 0.2,
          embeddingSimilarity: 0.75
        };
      }
    }
  );

  assert.equal(result.scoringInput.entityMatches?.[0]?.clusterId, item.candidate.candidateId);
  assert.equal(result.scoringInput.graphBoost?.get(item.candidate.candidateId), 0.2);
  assert.equal(result.scoringInput.embeddingSimilarity?.get(item.candidate.candidateId), 0.75);
});

test("Phase 4 rejects stale profile bindings", async () => {
  const staleProfile = profile([
    profileEntry("canonical_interest", "gaming.playstation", 0.2, 0.9)
  ]);
  const item = generated();

  await assert.rejects(
    () => buildColdStartScoringInput({
      profile: PROFILE,
      candidates: [bound(staleProfile, item)]
    }),
    /profile binding is stale/u
  );
});

test("Phase 4 rejects ineligible and mismatched eligibility bindings", async () => {
  const item = generated();
  const fingerprint = createRecommendationEmbeddingSourceFingerprint(PROFILE);

  await assert.rejects(
    () => buildColdStartScoringInput({
      profile: PROFILE,
      candidates: [{
        generated: item,
        eligibility: { ...eligible(item.candidate), eligible: false, reasonCodes: ["provider_policy_denied"] },
        profileFingerprint: fingerprint
      }]
    }),
    /requires an eligible candidate/u
  );

  const other = generated("did:plc:other");
  await assert.rejects(
    () => buildColdStartScoringInput({
      profile: PROFILE,
      candidates: [{
        generated: item,
        eligibility: eligible(other.candidate),
        profileFingerprint: fingerprint
      }]
    }),
    /bound to the same identity/u
  );
});

test("Phase 4 rejects duplicate scoring identities", async () => {
  const item = generated();
  const scoringCandidate = bound(PROFILE, item);

  await assert.rejects(
    () => buildColdStartScoringInput({
      profile: PROFILE,
      candidates: [scoringCandidate, scoringCandidate]
    }),
    /Duplicate cold-start scoring candidate identity/u
  );
});

test("Phase 4 rejects non-finite and mismatched optional feature bindings", async () => {
  const item = generated();

  await assert.rejects(
    () => buildColdStartScoringInput(
      { profile: PROFILE, candidates: [bound(PROFILE, item)] },
      { resolveFeatures: () => ({ graphBoost: Number.NaN }) }
    ),
    /graph boost/u
  );

  await assert.rejects(
    () => buildColdStartScoringInput(
      { profile: PROFILE, candidates: [bound(PROFILE, item)] },
      {
        resolveFeatures: () => ({
          entityMatch: {
            clusterId: "unknown",
            score: 0.5,
            matchedEntityIds: [],
            relationHits: []
          }
        })
      }
    ),
    /unknown candidate/u
  );
});

test("Phase 4 cancellation stops optional expensive work", async () => {
  const first = generated("did:plc:a");
  const second = generated("did:plc:b");
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    () => buildColdStartScoringInput(
      {
        profile: PROFILE,
        candidates: [bound(PROFILE, first), bound(PROFILE, second)],
        signal: controller.signal
      },
      {
        concurrency: 1,
        async resolveFeatures() {
          calls += 1;
          controller.abort(new Error("cancelled"));
          return {};
        }
      }
    ),
    /cancelled/u
  );

  assert.equal(calls, 1);
});

test("Phase 4 feature construction is deterministic despite resolver completion order", async () => {
  const a = generated("did:plc:a");
  const b = generated("did:plc:b");

  const result = await buildColdStartScoringInput(
    { profile: PROFILE, candidates: [bound(PROFILE, b), bound(PROFILE, a)] },
    {
      concurrency: 2,
      async resolveFeatures(context) {
        await new Promise((resolve) => setTimeout(resolve, context.candidateId === a.candidate.candidateId ? 5 : 0));
        return { graphBoost: context.candidateId === a.candidate.candidateId ? 0.1 : 0.2 };
      }
    }
  );

  assert.deepEqual(
    [...(result.scoringInput.graphBoost?.keys() ?? [])],
    [a.candidate.candidateId, b.candidate.candidateId].sort()
  );
});

test("Phase 4 enforces bounded candidate fan-out before resolver work", async () => {
  const first = generated();
  const second = generated("did:plc:other");
  let calls = 0;

  await assert.rejects(
    () => buildColdStartScoringInput(
      {
        profile: PROFILE,
        candidates: [bound(PROFILE, first), bound(PROFILE, second)]
      },
      {
        maxCandidates: 1,
        resolveFeatures() {
          calls += 1;
          return {};
        }
      }
    ),
    /candidate limit exceeded/u
  );

  assert.equal(calls, 0);
});
