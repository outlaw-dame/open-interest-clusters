import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  type RecommendationCandidate,
  type RecommendationCandidateKind
} from "../src/recommendation/candidate-domain.js";
import {
  evaluateRecommendationCandidateEligibility,
  type RecommendationCandidateEligibilityEvidence
} from "../src/recommendation/candidate-eligibility.js";

function candidate(
  kind: RecommendationCandidateKind,
  options: {
    verification?: RecommendationCandidate["verification"];
    availability?: RecommendationCandidate["availability"];
    nativeId?: string;
  } = {}
): RecommendationCandidate {
  const protocol = kind === "feed" || kind === "list" || kind === "starter_pack" || kind === "labeler"
    ? "atproto" as const
    : "activitypub" as const;
  const nativeId = options.nativeId ?? `${kind}:example`;
  const provider = protocol === "atproto" ? "bsky.app" : "social.example";
  const verification = options.verification ?? (
    kind === "feed" || kind === "list" || kind === "starter_pack" || kind === "labeler"
      ? { state: "authority_verified" as const, authority: "provider.example", verifiedAt: "2026-08-09T10:00:00Z" }
      : { state: "source_asserted" as const }
  );
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification,
    availability: options.availability ?? "available",
    observedAt: "2026-08-09T10:00:00Z",
    metadata: {
      canonicalInterestIds: [],
      tags: [],
      entityIds: [],
      languages: []
    },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "provider.example",
      observedAt: "2026-08-09T10:00:00Z",
      trustBoundary: "same_provider"
    }]
  };
}

const allowProvider = Object.freeze({ allowed: true, evidenceComplete: true });
const allowViewer = Object.freeze({ eligible: true, evidenceComplete: true });

function evidence(kind: Exclude<RecommendationCandidateKind, "account">): RecommendationCandidateEligibilityEvidence {
  switch (kind) {
    case "post": return { kind, explicitlyPublic: true, available: true, identityBound: true };
    case "feed": return { kind, resolvable: true, available: true };
    case "list": return { kind, resolvable: true, available: true };
    case "starter_pack": return { kind, resolvable: true, current: true, available: true, memberCount: 25 };
    case "labeler": return { kind, identityVerified: true, available: true, policyEligible: true };
    case "community": return { kind, exists: true, available: true, policyEligible: true };
    case "hashtag": return { kind, normalizedValidPublicTopic: true, locallyFiltered: false };
    case "topic": return { kind, canonicalCatalogIdentity: true, policySafeMetadata: true };
    case "instance": return { kind, healthy: true, registrationOpen: true, policyEligible: true };
  }
}

test("all non-account candidate kinds have an explicit eligible policy path", async () => {
  const kinds: readonly Exclude<RecommendationCandidateKind, "account">[] = [
    "post", "feed", "list", "starter_pack", "labeler", "community", "hashtag", "topic", "instance"
  ];
  for (const kind of kinds) {
    const result = await evaluateRecommendationCandidateEligibility({
      candidate: candidate(kind),
      evidence: evidence(kind),
      providerPolicy: allowProvider,
      viewerSafety: allowViewer,
      evaluatedAt: "2026-08-09T10:05:00Z"
    });
    assert.equal(result.eligible, true, kind);
    assert.deepEqual(result.reasonCodes, ["eligible"], kind);
  }
});

test("account eligibility reuses the existing moved-account resolver and activity gate", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:old" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      discoverable: true,
      noindex: false,
      optedOut: false,
      resolver: {
        resolve(reference) {
          if (reference === "acct:old") {
            return { id: "old", uri: "https://old.example/users/alice", movedTo: "acct:new" };
          }
          if (reference === "acct:new") {
            return { id: "new", uri: "https://new.example/users/alice", lastActivityAt: "2026-08-08T10:00:00Z" };
          }
          return undefined;
        }
      }
    },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
  assert.equal(result.resolvedAccount?.uri, "https://new.example/users/alice");
  assert.deepEqual(result.moveChain, ["https://old.example/users/alice"]);
});

test("account activity, discoverability, noindex, and opt-out gates fail closed", async () => {
  const inactive = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:inactive" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      discoverable: true,
      noindex: false,
      optedOut: false,
      resolver: { resolve: () => ({ id: "inactive", uri: "https://social.example/@inactive", lastActivityAt: "2026-01-01T00:00:00Z" }) }
    },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(inactive.eligible, false);
  assert.ok(inactive.reasonCodes.includes("account_inactive"));

  const curatedOut = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:private" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      discoverable: false,
      noindex: true,
      optedOut: true,
      resolver: { resolve: () => ({ id: "private", uri: "https://social.example/@private", lastActivityAt: "2026-08-09T09:00:00Z" }) }
    },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(curatedOut.eligible, false);
  assert.ok(curatedOut.reasonCodes.includes("account_not_discoverable"));
  assert.ok(curatedOut.reasonCodes.includes("account_noindex"));
  assert.ok(curatedOut.reasonCodes.includes("account_opted_out"));
});

test("provider and viewer safety evidence fail closed when incomplete", async () => {
  const provider = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    providerPolicy: { allowed: true, evidenceComplete: false },
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(provider.eligible, false);
  assert.deepEqual(provider.reasonCodes, ["provider_policy_incomplete"]);

  const viewer = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    providerPolicy: allowProvider,
    viewerSafety: { eligible: true, evidenceComplete: false },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(viewer.eligible, false);
  assert.deepEqual(viewer.reasonCodes, ["viewer_safety_incomplete"]);
});

test("empty moderation state is representable as complete and eligible", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("hashtag"),
    evidence: { kind: "hashtag", normalizedValidPublicTopic: true, locallyFiltered: false },
    providerPolicy: allowProvider,
    viewerSafety: { eligible: true, evidenceComplete: true },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
});

test("private viewer filter details cannot cross the eligibility gate contract", async () => {
  await assert.rejects(() => evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    providerPolicy: allowProvider,
    viewerSafety: { eligible: false, evidenceComplete: true, matchedKeywords: ["private"] } as never,
    evaluatedAt: "2026-08-09T10:00:00Z"
  }), /viewer-safety decision/u);

  await assert.rejects(() => evaluateRecommendationCandidateEligibility({
    candidate: candidate("hashtag"),
    evidence: { kind: "hashtag", normalizedValidPublicTopic: true, locallyFiltered: false, privateFilter: "secret" } as never,
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  }), /eligibility evidence/u);
});

test("strong-identity candidate kinds reject unverified or source-asserted identities", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("feed", { verification: { state: "source_asserted" } }),
    evidence: { kind: "feed", resolvable: true, available: true },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["identity_verification_required"]);
});

test("post publicness and identity binding are mandatory", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("post"),
    evidence: { kind: "post", explicitlyPublic: false, available: true, identityBound: false },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["post_identity_unbound", "post_not_public"]);
});

test("unavailable feeds and lists, stale oversized packs, and closed instances fail closed", async () => {
  const feed = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("feed"), evidence: { kind: "feed", resolvable: true, available: false },
    providerPolicy: allowProvider, viewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.ok(feed.reasonCodes.includes("feed_unavailable"));

  const list = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("list"), evidence: { kind: "list", resolvable: false, available: true },
    providerPolicy: allowProvider, viewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.ok(list.reasonCodes.includes("list_unresolvable"));

  const pack = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("starter_pack"), evidence: { kind: "starter_pack", resolvable: true, current: false, available: true, memberCount: 1001 },
    providerPolicy: allowProvider, viewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.ok(pack.reasonCodes.includes("starter_pack_stale"));
  assert.ok(pack.reasonCodes.includes("starter_pack_members_unbounded"));

  const instance = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("instance"), evidence: { kind: "instance", healthy: true, registrationOpen: false, policyEligible: true },
    providerPolicy: allowProvider, viewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(instance.reasonCodes, ["instance_registration_closed"]);
});

test("labelers require verified identity but eligibility never implies subscription", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("labeler"),
    evidence: { kind: "labeler", identityVerified: true, available: true, policyEligible: true },
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
  assert.equal("subscribed" in result, false);
  assert.equal("subscription" in result, false);
});

test("candidate-level unavailable state is a shared fail-closed gate", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic", { availability: "unavailable" }),
    evidence: evidence("topic"),
    providerPolicy: allowProvider,
    viewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["candidate_unavailable"]);
});
