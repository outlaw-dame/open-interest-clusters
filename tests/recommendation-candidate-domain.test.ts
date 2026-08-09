import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  normalizeRecommendationCandidate,
  normalizeRecommendationCandidateProvenance,
  normalizeRecommendationCandidateSet,
  normalizeRecommendationCandidateVerification,
  type RecommendationCandidate
} from "../src/recommendation/candidate-domain.js";

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  const kind = overrides.kind ?? "account";
  const protocol = overrides.protocol ?? "activitypub";
  const nativeId = overrides.nativeId ?? "https://social.example/users/alice";
  const provider = overrides.provider ?? "social.example";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    uri: "https://social.example/users/alice",
    verification: { state: "source_asserted" },
    availability: "unknown",
    observedAt: "2026-08-08T12:00:00Z",
    metadata: {
      displayName: "Alice",
      canonicalInterestIds: ["sports.basketball"],
      tags: ["basketball"],
      entityIds: ["wikidata:Q5372"],
      languages: ["en"]
    },
    provenance: [{
      kind: "curated_account_set",
      sourceId: "mastodon.collection.example",
      observedAt: "2026-08-08T12:00:00Z",
      trustBoundary: "remote_provider"
    }],
    ...overrides
  };
}

test("candidate identity is deterministic and independent of display metadata", () => {
  const left = createRecommendationCandidateId({
    kind: "account",
    protocol: "activitypub",
    nativeId: "https://social.example/users/alice",
    provider: "social.example"
  });
  const right = createRecommendationCandidateId({
    kind: "account",
    protocol: "activitypub",
    nativeId: "https://social.example/users/alice",
    provider: "social.example"
  });
  assert.equal(left, right);
  assert.match(left, /^candidate:v1:[0-9a-f]{64}$/u);

  const normalized = normalizeRecommendationCandidate(candidate({
    metadata: {
      displayName: "Changed display name",
      summary: "Public biography changed without changing identity.",
      canonicalInterestIds: ["sports.basketball"],
      tags: ["nba"],
      entityIds: [],
      languages: ["en"]
    }
  }));
  assert.equal(normalized.candidateId, left);
});

test("candidate normalization rejects an ID that is not bound to native identity", () => {
  assert.throws(
    () => normalizeRecommendationCandidate(candidate({ candidateId: "candidate:v1:" + "0".repeat(64) })),
    /does not match canonical identity/u
  );
});

test("candidate normalization freezes and deterministically sorts bounded metadata", () => {
  const normalized = normalizeRecommendationCandidate(candidate({
    metadata: {
      canonicalInterestIds: ["sports.nba", "sports.basketball"],
      tags: ["playoffs", "basketball"],
      entityIds: ["wikidata:Q155223", "wikidata:Q5372"],
      languages: ["en-US", "en"]
    }
  }));
  assert.deepEqual(normalized.metadata.canonicalInterestIds, ["sports.basketball", "sports.nba"]);
  assert.deepEqual(normalized.metadata.tags, ["basketball", "playoffs"]);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.metadata.tags));
});

test("candidate metadata rejects duplicates and excessive fan-out", () => {
  assert.throws(
    () => normalizeRecommendationCandidate(candidate({
      metadata: {
        canonicalInterestIds: ["sports.nba", "sports.nba"],
        tags: [],
        entityIds: [],
        languages: []
      }
    })),
    /canonical interests/u
  );

  assert.throws(
    () => normalizeRecommendationCandidate(candidate({
      metadata: {
        canonicalInterestIds: Array.from({ length: 129 }, (_, index) => `topic.${index}`),
        tags: [],
        entityIds: [],
        languages: []
      }
    })),
    /canonical interests/u
  );
});

test("provenance remains discovery evidence and third-party hints retain their trust boundary", () => {
  const provenance = normalizeRecommendationCandidateProvenance({
    kind: "third_party_directory_hint",
    sourceId: "directory.example",
    observedAt: "2026-08-08T12:00:00Z",
    trustBoundary: "third_party",
    sourceUrl: "https://directory.example/items/123"
  });
  assert.equal(provenance.kind, "third_party_directory_hint");
  assert.equal(provenance.trustBoundary, "third_party");

  assert.throws(
    () => normalizeRecommendationCandidateProvenance({
      ...provenance,
      trustBoundary: "same_provider"
    }),
    /must retain third-party trust/u
  );
});

test("verification cannot be forged from untrusted-only provenance", () => {
  const kind = "feed" as const;
  const protocol = "atproto" as const;
  const nativeId = "at://did:plc:example/app.bsky.feed.generator/news";
  assert.throws(
    () => normalizeRecommendationCandidate({
      candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider: "bsky.app" }),
      kind,
      protocol,
      nativeId,
      provider: "bsky.app",
      verification: {
        state: "authority_verified",
        authority: "did:plc:example",
        verifiedAt: "2026-08-08T12:00:00Z"
      },
      availability: "available",
      observedAt: "2026-08-08T12:00:00Z",
      metadata: {
        canonicalInterestIds: ["technology.news"],
        tags: [],
        entityIds: [],
        languages: ["en"]
      },
      provenance: [{
        kind: "third_party_directory_hint",
        sourceId: "directory.example",
        observedAt: "2026-08-08T12:00:00Z",
        trustBoundary: "third_party"
      }]
    }),
    /requires non-third-party provenance/u
  );
});

test("verified states require explicit verification authority and time", () => {
  assert.throws(
    () => normalizeRecommendationCandidateVerification({ state: "authority_verified" }),
    /requires authority and timestamp/u
  );
  assert.throws(
    () => normalizeRecommendationCandidateVerification({
      state: "unverified_hint",
      authority: "directory.example"
    }),
    /cannot carry verification authority/u
  );
});

test("candidate sets reject duplicate canonical identities", () => {
  const value = candidate();
  assert.throws(
    () => normalizeRecommendationCandidateSet([value, value]),
    /Duplicate recommendation candidate ID/u
  );
});

test("unsafe control characters are rejected from candidate identities and provenance", () => {
  assert.throws(
    () => createRecommendationCandidateId({
      kind: "account",
      protocol: "activitypub",
      nativeId: "https://social.example/users/alice\u0000"
    }),
    /native identity/u
  );
  assert.throws(
    () => normalizeRecommendationCandidateProvenance({
      kind: "provider_discovery",
      sourceId: "provider\u0000",
      observedAt: "2026-08-08T12:00:00Z",
      trustBoundary: "same_provider"
    }),
    /source ID/u
  );
});
