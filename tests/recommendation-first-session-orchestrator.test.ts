import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationCandidateId,
  createRecommendationFirstSessionOrchestrator,
  type RecommendationCandidate,
  type RecommendationCandidateSourceAdapter,
  type RecommendationFirstSessionEligibilityEvaluator,
  type RecommendationProfileSnapshot
} from "../src/index.js";

const NOW = "2026-09-25T00:00:00.000Z";
const PROFILE: RecommendationProfileSnapshot = {
  schemaVersion: "recommendation-profile.v1",
  updatedAt: NOW,
  signalCount: 1,
  entries: [{
    target: { kind: "canonical_interest", key: "gaming.playstation" },
    score: 0.9,
    confidence: 0.9,
    signalCount: 1,
    positiveSignalCount: 1,
    negativeSignalCount: 0,
    neutralSignalCount: 0,
    privacyBoundaries: ["local_only"],
    protocols: ["app_local"],
    sourceVisibilities: ["local_only"],
    updatedAt: NOW
  }]
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
    metadata: {
      canonicalInterestIds: ["gaming.playstation"],
      tags: [],
      entityIds: [],
      languages: ["en"]
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "test-source",
      observedAt: NOW,
      trustBoundary: "same_provider"
    }]
  };
}

function source(
  items: readonly RecommendationCandidate[],
  id = "test-source",
  read?: RecommendationCandidateSourceAdapter["read"]
): RecommendationCandidateSourceAdapter {
  return {
    id,
    protocols: ["atproto"],
    candidateKinds: ["account"],
    authority: "provider_native",
    transport: "local",
    privacy: {
      sourceVisibility: "public",
      accessBasis: "atproto_public_repo",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"],
    read: read ?? (() => ({ candidates: items }))
  };
}

test("Phase 5 composes discovery, eligibility, scoring, execution, and candidate-bound serving", async () => {
  const alice = candidate("did:plc:alice");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice])],
    candidateKinds: ["account"],
    evaluateEligibility: ({ candidate: generated }) => ({
      candidate: generated.candidate,
      eligible: true,
      reasonCodes: ["eligible"],
      evaluatedAt: NOW
    })
  });

  const result = await orchestrator.execute({
    subjectId: "local-user",
    requestId: "first-session-1",
    languages: ["en"],
    limit: 10
  });

  assert.equal(result.discoveredCandidateCount, 1);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.equal(result.eligibilityFailureCount, 0);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]?.candidate.candidateId, alice.candidateId);
  assert.equal(result.recommendations[0]?.rank, 1);
});

test("Phase 5 fails closed per candidate when eligibility evaluation fails", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice, bob])],
    candidateKinds: ["account"],
    evaluateEligibility: ({ candidate: generated }) => {
      if (generated.candidate.candidateId === alice.candidateId) throw new Error("provider lookup failed");
      return {
        candidate: generated.candidate,
        eligible: true,
        reasonCodes: ["eligible"],
        evaluatedAt: NOW
      };
    }
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-2" });
  assert.equal(result.discoveredCandidateCount, 2);
  assert.equal(result.eligibilityFailureCount, 1);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.equal(result.recommendations[0]?.candidate.candidateId, bob.candidateId);
});

test("Phase 5 propagates explicit cancellation instead of converting it to eligibility failure", async () => {
  const controller = new AbortController();
  const alice = candidate("did:plc:alice");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice])],
    candidateKinds: ["account"],
    evaluateEligibility: () => {
      controller.abort(new Error("cancelled"));
      throw new Error("resolver stopped");
    }
  });

  await assert.rejects(
    () => orchestrator.execute({
      subjectId: "local-user",
      requestId: "first-session-3",
      signal: controller.signal
    }),
    /cancelled/u
  );
});

function eligible(target: RecommendationCandidate) {
  return {
    candidate: target,
    eligible: true,
    reasonCodes: ["eligible"] as const,
    evaluatedAt: NOW
  };
}

const approve: RecommendationFirstSessionEligibilityEvaluator = (context) => eligible(context.candidate.candidate);

test("Phase 5 drops ineligible candidates without counting them as failures", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice, bob])],
    candidateKinds: ["account"],
    evaluateEligibility: ({ candidate: generated }) =>
      generated.candidate.candidateId === alice.candidateId
        ? { candidate: generated.candidate, eligible: false, reasonCodes: ["account_inactive"], evaluatedAt: NOW }
        : eligible(generated.candidate)
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-4" });
  assert.equal(result.discoveredCandidateCount, 2);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.equal(result.eligibilityFailureCount, 0);
  assert.deepEqual(result.recommendations.map((item) => item.candidate.candidateId), [bob.candidateId]);
});

test("Phase 5 counts an eligibility result for a different candidate as a failure", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([alice, bob])],
    candidateKinds: ["account"],
    // Alice's evaluation answers with Bob's candidate, which must not be trusted.
    evaluateEligibility: ({ candidate: generated }) =>
      eligible(generated.candidate.candidateId === alice.candidateId ? bob : generated.candidate)
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-5" });
  assert.equal(result.discoveredCandidateCount, 2);
  assert.equal(result.eligibilityFailureCount, 1);
  assert.equal(result.eligibleCandidateCount, 1);
  assert.deepEqual(result.recommendations.map((item) => item.candidate.candidateId), [bob.candidateId]);
});

test("Phase 5 reports a failing source and still recommends from the others", async () => {
  const alice = candidate("did:plc:alice");
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [
      source([], "broken-source", () => { throw new Error("upstream down"); }),
      source([alice], "working-source")
    ],
    candidateKinds: ["account"],
    evaluateEligibility: approve
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-6" });
  assert.deepEqual(result.sourceFailures, [{ sourceId: "broken-source", code: "source_read_failed" }]);
  assert.deepEqual(result.recommendations.map((item) => item.candidate.candidateId), [alice.candidateId]);
});

test("Phase 5 returns an empty result with every failure reported when all sources fail", async () => {
  let eligibilityCalls = 0;
  const fail = () => { throw new Error("upstream down"); };
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([], "source-b", fail), source([], "source-a", fail)],
    candidateKinds: ["account"],
    evaluateEligibility: (context) => {
      eligibilityCalls += 1;
      return eligible(context.candidate.candidate);
    }
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-7" });
  assert.deepEqual(result.sourceFailures, [
    { sourceId: "source-a", code: "source_read_failed" },
    { sourceId: "source-b", code: "source_read_failed" }
  ]);
  assert.equal(result.discoveredCandidateCount, 0);
  assert.equal(result.eligibleCandidateCount, 0);
  assert.equal(result.eligibilityFailureCount, 0);
  assert.equal(result.recommendations.length, 0);
  assert.equal(eligibilityCalls, 0);
});

test("Phase 5 handles sources that return zero candidates", async () => {
  const orchestrator = createRecommendationFirstSessionOrchestrator({
    engine: { readProfile: async () => PROFILE },
    sources: [source([])],
    candidateKinds: ["account"],
    evaluateEligibility: approve
  });

  const result = await orchestrator.execute({ subjectId: "local-user", requestId: "first-session-8" });
  assert.equal(result.discoveredCandidateCount, 0);
  assert.equal(result.eligibleCandidateCount, 0);
  assert.deepEqual(result.sourceFailures, []);
  assert.equal(result.recommendations.length, 0);
});

test("Phase 5 output does not depend on the order sources finish in", async () => {
  const alice = candidate("did:plc:alice");
  const bob = candidate("did:plc:bob");
  const delayed = (items: readonly RecommendationCandidate[], ms: number): RecommendationCandidateSourceAdapter["read"] =>
    async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { candidates: items };
    };
  const run = async (aliceDelay: number, bobDelay: number, order: "ab" | "ba") => {
    const sources = [
      source([alice], "source-a", delayed([alice], aliceDelay)),
      source([bob], "source-b", delayed([bob], bobDelay))
    ];
    const orchestrator = createRecommendationFirstSessionOrchestrator({
      engine: { readProfile: async () => PROFILE },
      sources: order === "ab" ? sources : [...sources].reverse(),
      candidateKinds: ["account"],
      evaluateEligibility: approve
    });
    return orchestrator.execute({ subjectId: "local-user", requestId: "first-session-9" });
  };

  const first = await run(30, 1, "ab");
  const second = await run(1, 30, "ba");
  const ids = (result: Awaited<ReturnType<typeof run>>) =>
    result.recommendations.map((item) => [item.candidate.candidateId, item.rank, item.score]);
  assert.equal(first.recommendations.length, 2);
  assert.deepEqual(ids(first), ids(second));
});
