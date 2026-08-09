import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  evaluateRecommendationCandidateEligibility,
  filterRecommendationEligibleColdStartCandidates,
  type RecommendationCandidate,
  type RecommendationCandidateEligibilityEvidence,
  type RecommendationCandidateKind,
  type RecommendationColdStartGeneratedCandidate
} from "../src/index.js";

const NOW = "2026-08-09T10:00:00.000Z";

function candidate(
  kind: RecommendationCandidateKind,
  options: {
    nativeId?: string;
    availability?: RecommendationCandidate["availability"];
    verification?: RecommendationCandidate["verification"];
    protocol?: RecommendationCandidate["protocol"];
    uri?: string;
  } = {}
): RecommendationCandidate {
  const protocol = options.protocol ?? (kind === "topic" ? "app_local" : "atproto");
  const nativeId = options.nativeId ?? `${kind}.example`;
  const provider = protocol === "app_local" ? undefined : "provider.example";
  const verification = options.verification ?? { state: "source_asserted" as const };
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, ...(provider === undefined ? {} : { provider }) }),
    kind,
    protocol,
    nativeId,
    ...(provider === undefined ? {} : { provider }),
    ...(options.uri === undefined ? {} : { uri: options.uri }),
    verification,
    availability: options.availability ?? "available",
    observedAt: NOW,
    metadata: {
      canonicalInterestIds: [],
      tags: [],
      entityIds: [],
      languages: []
    },
    provenance: [{
      kind: verification.state === "canonical" ? "local_catalog" : "provider_discovery",
      sourceId: verification.state === "canonical" ? "catalog.local" : "provider.native",
      observedAt: NOW,
      trustBoundary: verification.state === "canonical" ? "local" : "same_provider"
    }]
  };
}

const providerAllowed = { providerPolicyAllowsRecommendation: true } as const;

function strong(kind: RecommendationCandidateKind, nativeId?: string): RecommendationCandidate {
  return candidate(kind, {
    ...(nativeId === undefined ? {} : { nativeId }),
    verification: {
      state: "authority_verified",
      authority: "provider.native",
      verifiedAt: NOW
    }
  });
}

test("account eligibility reuses the existing inactivity and moved-account gate", async () => {
  const account = candidate("account", {
    protocol: "activitypub",
    nativeId: "https://old.example/users/alice",
    uri: "https://old.example/users/alice",
    availability: "unknown"
  });
  const profiles = new Map([
    ["https://old.example/users/alice", {
      id: "old",
      uri: "https://old.example/users/alice",
      movedTo: "https://new.example/users/alice"
    }],
    ["https://new.example/users/alice", {
      id: "new",
      uri: "https://new.example/users/alice",
      lastActivityAt: "2026-08-08T10:00:00.000Z"
    }]
  ]);
  let safetySawResolved: string | undefined;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: account,
    evidence: {
      kind: "account",
      ...providerAllowed,
      evaluatedAt: NOW,
      resolver: { resolve: (reference) => profiles.get(reference) }
    },
    viewerSafety: {
      authority: "device_owned",
      processingBoundary: "local_only",
      evaluate(input) {
        safetySawResolved = input.resolvedAccount?.uri;
        return { eligible: true, evidenceComplete: true };
      }
    }
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "eligible");
  assert.equal(result.resolvedAccount?.uri, "https://new.example/users/alice");
  assert.deepEqual(result.resolvedAccount?.moveChain, ["https://old.example/users/alice"]);
  assert.equal(safetySawResolved, "https://new.example/users/alice");
});

test("account inactivity, deletion, unresolved activity, and move loops fail closed through the reused gate", async () => {
  const account = candidate("account", { availability: "unknown" });
  for (const [profile, expected] of [
    [{ id: "a", uri: "account.example", lastActivityAt: "2026-06-01T10:00:00.000Z" }, "account_inactive"],
    [{ id: "a", uri: "account.example", deleted: true }, "account_deleted"],
    [{ id: "a", uri: "account.example" }, "account_unresolved"]
  ] as const) {
    const result = await evaluateRecommendationCandidateEligibility({
      candidate: account,
      evidence: {
        kind: "account",
        ...providerAllowed,
        evaluatedAt: NOW,
        resolver: { resolve: () => profile }
      }
    });
    assert.equal(result.reason, expected);
  }

  const loop = await evaluateRecommendationCandidateEligibility({
    candidate: account,
    evidence: {
      kind: "account",
      ...providerAllowed,
      evaluatedAt: NOW,
      resolver: {
        resolve(reference) {
          return reference === "account.example"
            ? { id: "a", uri: "account.example", movedTo: "account.two" }
            : { id: "b", uri: "account.two", movedTo: "account.example" };
        }
      }
    }
  });
  assert.equal(loop.reason, "account_move_loop");
});

test("viewer-private safety is filter-only and allowed only on device-owned or user-owned boundaries", async () => {
  const feed = strong("feed");
  const evidence: RecommendationCandidateEligibilityEvidence = {
    kind: "feed",
    ...providerAllowed,
    resolvable: true
  };

  const emptyModeration = await evaluateRecommendationCandidateEligibility({
    candidate: feed,
    evidence,
    viewerSafety: {
      authority: "device_owned",
      processingBoundary: "local_only",
      evaluate: () => ({ eligible: true, evidenceComplete: true })
    }
  });
  assert.equal(emptyModeration.eligible, true);

  const blocked = await evaluateRecommendationCandidateEligibility({
    candidate: feed,
    evidence,
    viewerSafety: {
      authority: "user_owned",
      processingBoundary: "server_allowed",
      evaluate: () => ({ eligible: false, evidenceComplete: true })
    }
  });
  assert.equal(blocked.reason, "viewer_safety_denied");
  assert.equal(JSON.stringify(blocked).includes("block"), false);

  let providerReads = 0;
  const providerOwned = await evaluateRecommendationCandidateEligibility({
    candidate: feed,
    evidence,
    viewerSafety: {
      authority: "provider_owned",
      processingBoundary: "server_allowed",
      evaluate: () => {
        providerReads += 1;
        return { eligible: true, evidenceComplete: true };
      }
    }
  });
  assert.equal(providerOwned.reason, "viewer_safety_placement_denied");
  assert.equal(providerReads, 0);

  const incomplete = await evaluateRecommendationCandidateEligibility({
    candidate: feed,
    evidence,
    viewerSafety: {
      authority: "device_owned",
      processingBoundary: "local_only",
      evaluate: () => ({ eligible: true, evidenceComplete: false })
    }
  });
  assert.equal(incomplete.reason, "viewer_safety_incomplete");
});

test("posts must be public, available, identity-bound, and at least source asserted", async () => {
  const post = candidate("post");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: post,
    evidence: { kind: "post", ...providerAllowed, explicitlyPublic: false, identityBound: true }
  })).reason, "post_not_public");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: candidate("post", { availability: "unavailable" }),
    evidence: { kind: "post", ...providerAllowed, explicitlyPublic: true, identityBound: true }
  })).reason, "candidate_unavailable");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: post,
    evidence: { kind: "post", ...providerAllowed, explicitlyPublic: true, identityBound: false }
  })).reason, "post_identity_unbound");
});

test("feeds and lists require availability, resolvability, and authoritative verification", async () => {
  for (const kind of ["feed", "list"] as const) {
    assert.equal((await evaluateRecommendationCandidateEligibility({
      candidate: strong(kind),
      evidence: { kind, ...providerAllowed, resolvable: true }
    })).eligible, true);
    assert.equal((await evaluateRecommendationCandidateEligibility({
      candidate: candidate(kind),
      evidence: { kind, ...providerAllowed, resolvable: true }
    })).reason, "identity_unverified");
    assert.equal((await evaluateRecommendationCandidateEligibility({
      candidate: strong(kind, `${kind}.stale`),
      evidence: { kind, ...providerAllowed, resolvable: false }
    })).reason, "resource_unresolvable");
  }
});

test("starter packs require current bounded membership and strong verification", async () => {
  const pack = strong("starter_pack");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: pack,
    evidence: { kind: "starter_pack", ...providerAllowed, resolvable: true, current: false, memberCount: 20 }
  })).reason, "starter_pack_not_current");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: pack,
    evidence: { kind: "starter_pack", ...providerAllowed, resolvable: true, current: true, memberCount: 501 }
  })).reason, "starter_pack_members_unbounded");
});

test("labelers require verified identity and always retain explicit-subscription semantics", async () => {
  const verified = await evaluateRecommendationCandidateEligibility({
    candidate: strong("labeler"),
    evidence: { kind: "labeler", ...providerAllowed, didOrIdentityVerified: true }
  });
  assert.equal(verified.eligible, true);
  assert.equal(verified.requiresExplicitSubscription, true);

  const unverified = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("labeler"),
    evidence: { kind: "labeler", ...providerAllowed, didOrIdentityVerified: false }
  });
  assert.equal(unverified.reason, "labeler_identity_unverified");
  assert.equal(unverified.requiresExplicitSubscription, true);
});

test("communities, hashtags, topics, and instances apply explicit kind-specific fail-closed rules", async () => {
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: candidate("community"),
    evidence: { kind: "community", ...providerAllowed, exists: false }
  })).reason, "community_unavailable");

  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: candidate("hashtag", { nativeId: "#PlayStation" }),
    evidence: { kind: "hashtag", ...providerAllowed, publicTopic: true }
  })).reason, "hashtag_invalid");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: candidate("hashtag", { nativeId: "playstation" }),
    evidence: { kind: "hashtag", ...providerAllowed, publicTopic: true }
  })).eligible, true);

  const topic = candidate("topic", {
    nativeId: "gaming.playstation",
    verification: { state: "canonical", authority: "catalog.local", verifiedAt: NOW }
  });
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: topic,
    evidence: { kind: "topic", ...providerAllowed, canonicalCatalogIdentity: true, policySafeMetadata: true }
  })).eligible, true);
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: topic,
    evidence: { kind: "topic", ...providerAllowed, canonicalCatalogIdentity: true, policySafeMetadata: false }
  })).reason, "topic_metadata_unsafe");

  const instance = candidate("instance");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: instance,
    evidence: { kind: "instance", ...providerAllowed, current: true, healthy: true, purpose: "signup", registrationOpen: false }
  })).reason, "instance_registration_closed");
  assert.equal((await evaluateRecommendationCandidateEligibility({
    candidate: instance,
    evidence: { kind: "instance", ...providerAllowed, current: true, healthy: true, purpose: "discovery" }
  })).eligible, true);
});

test("provider policy denial happens before viewer-private evaluation", async () => {
  let safetyReads = 0;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: strong("feed"),
    evidence: { kind: "feed", providerPolicyAllowsRecommendation: false, resolvable: true },
    viewerSafety: {
      authority: "device_owned",
      processingBoundary: "local_only",
      evaluate: () => {
        safetyReads += 1;
        return { eligible: true, evidenceComplete: true };
      }
    }
  });
  assert.equal(result.reason, "provider_policy_denied");
  assert.equal(safetyReads, 0);
});

test("batch filtering isolates evidence failures and keeps private safety out of affinity features", async () => {
  const eligibleCandidate = strong("feed", "feed.good");
  const failingCandidate = strong("feed", "feed.fail");
  const match = Object.freeze({
    canonicalInterestIds: Object.freeze(["gaming.playstation"]),
    tags: Object.freeze([]),
    entityIds: Object.freeze([]),
    matchedProfileTargets: Object.freeze([{ kind: "canonical_interest" as const, key: "gaming.playstation", weight: 1 }]),
    profileAffinityWeight: 1,
    languageCompatibility: "not_requested" as const,
    matchedLanguages: Object.freeze([])
  });
  const candidates: RecommendationColdStartGeneratedCandidate[] = [
    { candidate: eligibleCandidate, match },
    { candidate: failingCandidate, match }
  ];

  const result = await filterRecommendationEligibleColdStartCandidates({
    candidates,
    resolveEvidence(candidate) {
      if (candidate.nativeId === "feed.fail") throw new Error("private provider error");
      return { kind: "feed", ...providerAllowed, resolvable: true };
    },
    viewerSafety: {
      authority: "device_owned",
      processingBoundary: "local_only",
      evaluate: () => ({ eligible: true, evidenceComplete: true })
    }
  });

  assert.equal(result.eligible.length, 1);
  assert.deepEqual(result.eligible[0]?.match, match);
  assert.deepEqual(result.failures, [{
    candidateId: failingCandidate.candidateId,
    reason: "evidence_resolution_failed"
  }]);
  assert.equal(JSON.stringify(result).includes("private provider error"), false);
});
