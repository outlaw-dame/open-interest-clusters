import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  generateRecommendationColdStartCandidates,
  type RecommendationCandidate,
  type RecommendationCandidateSourceAdapter,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const VERIFIED_AT = "2026-08-09T09:00:00.000Z";

const profile: RecommendationProfileSnapshot = {
  schemaVersion: "recommendation-profile.v1",
  updatedAt: VERIFIED_AT,
  signalCount: 1,
  entries: [{
    target: { kind: "canonical_interest", key: "gaming.playstation" },
    score: 1,
    confidence: 1,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries: ["local_only"],
    protocols: ["atproto"],
    sourceVisibilities: ["public"],
    updatedAt: VERIFIED_AT
  }]
};

function identity() {
  return {
    kind: "account" as const,
    protocol: "atproto" as const,
    nativeId: "did:plc:provenance-boundary",
    provider: "bsky.app"
  };
}

function verifiedCandidate(): RecommendationCandidate {
  const value = identity();
  return {
    candidateId: createRecommendationCandidateId(value),
    ...value,
    verification: {
      state: "authority_verified",
      authority: value.nativeId,
      verifiedAt: VERIFIED_AT
    },
    availability: "available",
    observedAt: VERIFIED_AT,
    metadata: {
      canonicalInterestIds: ["gaming.playstation"],
      tags: [],
      entityIds: [],
      languages: []
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "native.authority",
      observedAt: VERIFIED_AT,
      trustBoundary: "same_provider"
    }]
  };
}

function hintCandidate(index: number): RecommendationCandidate {
  const value = identity();
  const second = String(index).padStart(2, "0");
  return {
    candidateId: createRecommendationCandidateId(value),
    ...value,
    verification: { state: "unverified_hint" },
    availability: "unknown",
    observedAt: `2026-08-09T10:00:${second}.000Z`,
    metadata: {
      canonicalInterestIds: ["gaming.playstation"],
      tags: [],
      entityIds: [],
      languages: []
    },
    provenance: [{
      kind: "third_party_directory_hint",
      sourceId: `directory-${index}`,
      observedAt: `2026-08-09T10:00:${second}.000Z`,
      trustBoundary: "third_party"
    }]
  };
}

function source(
  id: string,
  candidate: RecommendationCandidate,
  authority: RecommendationCandidateSourceAdapter["authority"],
  capabilities: RecommendationCandidateSourceAdapter["capabilities"]
): RecommendationCandidateSourceAdapter {
  return {
    id,
    protocols: ["atproto"],
    candidateKinds: ["account"],
    authority,
    transport: "local",
    privacy: {
      sourceVisibility: "local_only",
      accessBasis: "owner",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities,
    read: () => ({ candidates: [candidate] })
  };
}

test("bounded provenance merge retains trusted evidence supporting verified state", async () => {
  const sources: RecommendationCandidateSourceAdapter[] = [
    source(
      "native.authority",
      verifiedCandidate(),
      "protocol_native",
      ["discover", "returns_public_metadata", "returns_authority_verified_identity"]
    )
  ];

  for (let index = 0; index < 33; index += 1) {
    sources.push(source(
      `directory-${index}`,
      hintCandidate(index),
      "untrusted_hint",
      ["discover", "returns_public_metadata", "returns_untrusted_hints"]
    ));
  }

  const result = await generateRecommendationColdStartCandidates({
    requestId: "provenance-retention",
    profile,
    sources,
    candidateKinds: ["account"],
    concurrency: 8
  });

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0]?.candidate;
  assert.ok(candidate);
  assert.equal(candidate.verification.state, "authority_verified");
  assert.equal(candidate.provenance.length, 32);
  assert.equal(
    candidate.provenance.some((entry) =>
      entry.sourceId === "native.authority" && entry.trustBoundary === "same_provider"
    ),
    true
  );
});

test("runtime validation rejects unknown candidate kinds before source I/O", async () => {
  let reads = 0;
  const adapter = source(
    "never-read",
    verifiedCandidate(),
    "protocol_native",
    ["discover", "returns_public_metadata", "returns_authority_verified_identity"]
  );
  const wrapped: RecommendationCandidateSourceAdapter = {
    ...adapter,
    read(query) {
      reads += 1;
      return adapter.read(query);
    }
  };

  await assert.rejects(
    () => generateRecommendationColdStartCandidates({
      requestId: "invalid-kind",
      profile,
      sources: [wrapped],
      candidateKinds: ["not-a-kind" as never]
    }),
    /Invalid cold-start candidate requested kinds/u
  );
  assert.equal(reads, 0);
});
