import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  generateRecommendationColdStartCandidates,
  type RecommendationCandidate,
  type RecommendationCandidateProvenance,
  type RecommendationCandidateSourceAdapter,
  type RecommendationProfileEntry,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-08-09T10:00:00.000Z";

function profileEntry(
  kind: RecommendationProfileEntry["target"]["kind"],
  key: string,
  score: number,
  confidence = 1,
  positiveSignalCount = score > 0 ? 1 : 0,
  negativeSignalCount = score < 0 ? 1 : 0
): RecommendationProfileEntry {
  const neutralSignalCount = positiveSignalCount === 0 && negativeSignalCount === 0 ? 1 : 0;
  return {
    target: { kind, key },
    score,
    confidence,
    signalCount: positiveSignalCount + negativeSignalCount + neutralSignalCount,
    positiveSignalCount,
    negativeSignalCount,
    neutralSignalCount,
    privacyBoundaries: ["local_only"],
    protocols: ["atproto"],
    sourceVisibilities: ["public"],
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

function provenance(
  sourceId: string,
  kind: RecommendationCandidateProvenance["kind"] = "provider_discovery",
  trustBoundary: RecommendationCandidateProvenance["trustBoundary"] = "same_provider"
): RecommendationCandidateProvenance {
  return {
    kind,
    sourceId,
    observedAt: NOW,
    trustBoundary
  };
}

function candidate(input: {
  nativeId?: string;
  verification?: RecommendationCandidate["verification"];
  provenance?: readonly RecommendationCandidateProvenance[];
  canonicalInterestIds?: readonly string[];
  tags?: readonly string[];
  entityIds?: readonly string[];
  languages?: readonly string[];
  observedAt?: string;
  availability?: RecommendationCandidate["availability"];
} = {}): RecommendationCandidate {
  const kind = "account" as const;
  const protocol = "atproto" as const;
  const nativeId = input.nativeId ?? "did:plc:candidate";
  const provider = "bsky.app";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification: input.verification ?? { state: "source_asserted" },
    availability: input.availability ?? "available",
    observedAt: input.observedAt ?? NOW,
    metadata: {
      canonicalInterestIds: input.canonicalInterestIds ?? ["gaming.playstation"],
      tags: input.tags ?? [],
      entityIds: input.entityIds ?? [],
      languages: input.languages ?? ["en"]
    },
    provenance: input.provenance ?? [provenance("native.test")]
  };
}

function localSource(
  id: string,
  read: RecommendationCandidateSourceAdapter["read"],
  overrides: Partial<RecommendationCandidateSourceAdapter> = {}
): RecommendationCandidateSourceAdapter {
  return {
    id,
    protocols: ["atproto"],
    candidateKinds: ["account"],
    authority: "curated_public",
    transport: "local",
    privacy: {
      sourceVisibility: "local_only",
      accessBasis: "owner",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities: ["discover", "returns_public_metadata"],
    read,
    ...overrides
  };
}

const onboardingProfile = profile([
  profileEntry("canonical_interest", "gaming.playstation", 0.9, 0.9),
  profileEntry("hashtag", "PlayStation", 0.7, 0.8),
  profileEntry("entity", "Q-playstation", 0.6, 0.8),
  profileEntry("moderation_label", "spam", 1, 1),
  profileEntry("keyword", "blocked-topic", -1, 1, 0, 1)
]);

test("cold-start generation matches only positive affinity evidence and excludes moderation settings", async () => {
  let seenInterests: readonly string[] | undefined;
  const source = localSource("local.catalog", (query) => {
    seenInterests = query.canonicalInterestIds;
    return {
      candidates: [candidate({
        canonicalInterestIds: ["gaming.playstation"],
        tags: ["PLAYSTATION", "spam", "blocked-topic"],
        entityIds: ["Q-playstation"]
      })]
    };
  });

  const result = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-1",
    profile: onboardingProfile,
    sources: [source],
    candidateKinds: ["account"],
    languages: ["en"]
  });

  assert.deepEqual(seenInterests, ["gaming.playstation"]);
  assert.equal(result.candidates.length, 1);
  const match = result.candidates[0]?.match;
  assert.ok(match);
  assert.deepEqual(match.canonicalInterestIds, ["gaming.playstation"]);
  assert.deepEqual(match.tags, ["PLAYSTATION"]);
  assert.deepEqual(match.entityIds, ["Q-playstation"]);
  assert.equal(match.languageCompatibility, "compatible");
  assert.deepEqual(
    match.matchedProfileTargets.map((target) => `${target.kind}:${target.key}`),
    ["canonical_interest:gaming.playstation", "entity:Q-playstation", "hashtag:PlayStation"]
  );
  assert.equal(match.matchedProfileTargets.some((target) => target.key === "spam"), false);
  assert.equal(match.matchedProfileTargets.some((target) => target.key === "blocked-topic"), false);
});

test("duplicate candidates collapse while preserving bounded provenance and strongest valid verification", async () => {
  const unverified = candidate({
    verification: { state: "unverified_hint" },
    provenance: [provenance("directory.test", "third_party_directory_hint", "third_party")],
    tags: ["playstation"]
  });
  const verified = candidate({
    verification: {
      state: "authority_verified",
      authority: "did:plc:candidate",
      verifiedAt: NOW
    },
    provenance: [provenance("atproto.native")],
    entityIds: ["Q-playstation"]
  });

  const directory = localSource(
    "directory.test",
    () => ({ candidates: [unverified] }),
    {
      authority: "untrusted_hint",
      capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints"]
    }
  );
  const native = localSource(
    "atproto.native",
    () => ({ candidates: [verified] }),
    {
      authority: "protocol_native",
      capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"]
    }
  );

  const result = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-merge",
    profile: onboardingProfile,
    sources: [directory, native],
    candidateKinds: ["account"]
  });

  assert.equal(result.candidates.length, 1);
  const merged = result.candidates[0]?.candidate;
  assert.ok(merged);
  assert.equal(merged.verification.state, "authority_verified");
  assert.deepEqual(merged.metadata.tags, ["playstation"]);
  assert.deepEqual(merged.metadata.entityIds, ["Q-playstation"]);
  assert.deepEqual(merged.provenance.map((entry) => entry.sourceId).sort(), ["atproto.native", "directory.test"]);
});

test("a lone untrusted hint remains unverified", async () => {
  const hint = candidate({
    verification: { state: "unverified_hint" },
    provenance: [provenance("directory.test", "third_party_directory_hint", "third_party")]
  });
  const source = localSource(
    "directory.test",
    () => ({ candidates: [hint] }),
    {
      authority: "untrusted_hint",
      capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints"]
    }
  );

  const result = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-hint",
    profile: onboardingProfile,
    sources: [source],
    candidateKinds: ["account"]
  });
  assert.equal(result.candidates[0]?.candidate.verification.state, "unverified_hint");
});

test("partial provider failure is isolated and reported with a privacy-safe reason", async () => {
  const healthy = localSource("healthy", () => ({ candidates: [candidate()] }));
  const failing = localSource("failing", () => {
    throw new Error("secret provider diagnostic");
  });

  const result = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-partial",
    profile: onboardingProfile,
    sources: [failing, healthy],
    candidateKinds: ["account"]
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.successfulSourceCount, 1);
  assert.deepEqual(result.failures, [{ sourceId: "failing", code: "source_read_failed" }]);
  assert.equal(JSON.stringify(result).includes("secret provider diagnostic"), false);
});

test("empty sources and zero-result sources are safe", async () => {
  const empty = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-empty",
    profile: onboardingProfile,
    sources: [],
    candidateKinds: ["account"]
  });
  assert.deepEqual(empty.candidates, []);
  assert.deepEqual(empty.failures, []);

  const noResults = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-zero",
    profile: onboardingProfile,
    sources: [localSource("empty-source", () => ({ candidates: [] }))],
    candidateKinds: ["account"]
  });
  assert.deepEqual(noResults.candidates, []);
  assert.equal(noResults.successfulSourceCount, 1);
});

test("output truncation is deterministic and bounded", async () => {
  const source = localSource("many", () => ({
    candidates: [
      candidate({ nativeId: "did:plc:a", canonicalInterestIds: ["gaming.playstation"] }),
      candidate({ nativeId: "did:plc:b", canonicalInterestIds: ["gaming.playstation"], tags: ["playstation"] }),
      candidate({ nativeId: "did:plc:c", canonicalInterestIds: ["gaming.playstation"], tags: ["playstation"], entityIds: ["Q-playstation"] })
    ]
  }));

  const result = await generateRecommendationColdStartCandidates({
    requestId: "cold-start-bound",
    profile: onboardingProfile,
    sources: [source],
    candidateKinds: ["account"],
    maxCandidates: 2
  });

  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0]?.candidate.nativeId, "did:plc:c");
  assert.equal(result.candidates[1]?.candidate.nativeId, "did:plc:b");
});

test("pre-aborted generation cancels before source I/O", async () => {
  let reads = 0;
  const source = localSource("never-read", () => {
    reads += 1;
    return { candidates: [candidate()] };
  });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));

  await assert.rejects(
    () => generateRecommendationColdStartCandidates({
      requestId: "cold-start-abort",
      profile: onboardingProfile,
      sources: [source],
      candidateKinds: ["account"],
      signal: controller.signal
    }),
    /cancelled/u
  );
  assert.equal(reads, 0);
});

test("source fan-out rejects duplicate IDs and excessive source counts before I/O", async () => {
  let reads = 0;
  const source = localSource("duplicate", () => {
    reads += 1;
    return { candidates: [] };
  });

  await assert.rejects(
    () => generateRecommendationColdStartCandidates({
      requestId: "cold-start-duplicate-source",
      profile: onboardingProfile,
      sources: [source, source],
      candidateKinds: ["account"]
    }),
    /Duplicate cold-start candidate source adapter ID/u
  );

  const tooMany = Array.from({ length: 65 }, (_, index) =>
    localSource(`source-${index}`, () => ({ candidates: [] }))
  );
  await assert.rejects(
    () => generateRecommendationColdStartCandidates({
      requestId: "cold-start-too-many-sources",
      profile: onboardingProfile,
      sources: tooMany,
      candidateKinds: ["account"]
    }),
    /Invalid cold-start candidate sources/u
  );
  assert.equal(reads, 0);
});
