import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  normalizeRecommendationCandidate
} from "../src/recommendation/candidate-domain.js";

function candidate(overrides: Record<string, unknown> = {}) {
  const kind = "account" as const;
  const protocol = "activitypub" as const;
  const nativeId = "https://social.example/users/alice";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId }),
    kind,
    protocol,
    nativeId,
    uri: nativeId,
    verification: { state: "source_asserted" },
    availability: "available",
    observedAt: "2026-08-08T12:00:00Z",
    metadata: {
      canonicalInterestIds: ["technology"],
      tags: [],
      entityIds: [],
      languages: ["en"]
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "activitypub.public",
      observedAt: "2026-08-08T12:00:00Z",
      trustBoundary: "same_provider"
    }],
    ...overrides
  };
}

test("candidate timestamps require timezone-bearing strict RFC3339", () => {
  assert.throws(
    () => normalizeRecommendationCandidate(candidate({ observedAt: "2026-08-08T12:00:00" })),
    /observation timestamp/u
  );
  assert.throws(
    () => normalizeRecommendationCandidate(candidate({ observedAt: "2026-02-30T12:00:00Z" })),
    /observation timestamp/u
  );
});

test("verification and provenance timestamps also use strict RFC3339", () => {
  assert.throws(
    () => normalizeRecommendationCandidate(candidate({
      verification: {
        state: "authority_verified",
        authority: "https://social.example/",
        verifiedAt: "2026-08-08T12:00:00"
      }
    })),
    /verification timestamp/u
  );

  assert.throws(
    () => normalizeRecommendationCandidate(candidate({
      provenance: [{
        kind: "provider_discovery",
        sourceId: "activitypub.public",
        observedAt: "2026-02-30T12:00:00Z",
        trustBoundary: "same_provider"
      }]
    })),
    /provenance timestamp/u
  );
});

test("strict RFC3339 offsets normalize deterministically to UTC", () => {
  const normalized = normalizeRecommendationCandidate(candidate({
    observedAt: "2026-08-08T08:00:00-04:00"
  }));
  assert.equal(normalized.observedAt, "2026-08-08T12:00:00.000Z");
});
