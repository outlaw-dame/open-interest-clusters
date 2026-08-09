import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  normalizeRecommendationCandidate
} from "../src/recommendation/candidate-domain.js";

function candidate(nativeId: string) {
  return {
    candidateId: createRecommendationCandidateId({
      kind: "hashtag" as const,
      protocol: "activitypub" as const,
      nativeId,
      provider: "social.example"
    }),
    kind: "hashtag" as const,
    protocol: "activitypub" as const,
    nativeId,
    provider: "social.example",
    verification: { state: "source_asserted" as const },
    availability: "available" as const,
    observedAt: "2026-08-09T10:00:00Z",
    metadata: {
      canonicalInterestIds: [],
      tags: [],
      entityIds: [],
      languages: []
    },
    provenance: [{
      kind: "provider_discovery" as const,
      sourceId: "social.example",
      observedAt: "2026-08-09T10:00:00Z",
      trustBoundary: "same_provider" as const
    }]
  };
}

test("hashtag candidate identities are canonical lowercase hashless values", () => {
  const id = createRecommendationCandidateId({
    kind: "hashtag",
    protocol: "activitypub",
    nativeId: "playstation",
    provider: "social.example"
  });
  assert.match(id, /^candidate:v1:/u);
  assert.equal(normalizeRecommendationCandidate(candidate("playstation")).nativeId, "playstation");

  for (const nativeId of ["#playstation", "PlayStation", "ＰｌａｙＳｔａｔｉｏｎ"]) {
    assert.throws(
      () => createRecommendationCandidateId({
        kind: "hashtag",
        protocol: "activitypub",
        nativeId,
        provider: "social.example"
      }),
      /canonical and hashless/u
    );
  }
});

test("non-hashtag candidate identities retain provider-canonical opaque semantics", () => {
  const id = createRecommendationCandidateId({
    kind: "account",
    protocol: "activitypub",
    nativeId: "https://Social.Example/@Alice",
    provider: "social.example"
  });
  assert.match(id, /^candidate:v1:/u);
});
