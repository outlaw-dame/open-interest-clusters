import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  type RecommendationCandidate,
  type RecommendationCandidateKind
} from "../src/recommendation/candidate-domain.js";
import {
  evaluateRecommendationCandidateEligibility,
  type RecommendationCandidateEligibilityEvidence,
  type RecommendationCandidatePolicyEvaluationContext
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

const allowProvider = () => ({ allowed: true, evidenceComplete: true });
const allowViewer = () => ({ eligible: true, evidenceComplete: true });
const allowResolvedAccount = () => ({ restrictions: [] as const, evidenceComplete: true });

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
      evaluateProviderPolicy: allowProvider,
      evaluateViewerSafety: allowViewer,
      evaluatedAt: "2026-08-09T10:05:00Z"
    });
    assert.equal(result.eligible, true, kind);
    assert.deepEqual(result.reasonCodes, ["eligible"], kind);
  }
});

test("moved accounts resolve before account policy, provider policy, and viewer safety", async () => {
  const seen: string[] = [];
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:old" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: {
        resolve(reference) {
          if (reference === "acct:old") return { id: "old", uri: "https://old.example/@alice", movedTo: "acct:new" };
          if (reference === "acct:new") return { id: "new", uri: "https://new.example/@alice", lastActivityAt: "2026-08-08T10:00:00Z" };
          return undefined;
        }
      },
      evaluateResolvedAccountPolicy(context) {
        seen.push(`account:${context.resolvedAccount.uri}`);
        return allowResolvedAccount();
      }
    },
    evaluateProviderPolicy(context) {
      seen.push(`provider:${context.resolvedAccount?.uri}`);
      return { allowed: true, evidenceComplete: true };
    },
    evaluateViewerSafety(context) {
      seen.push(`viewer:${context.resolvedAccount?.uri}`);
      return { eligible: true, evidenceComplete: true };
    },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });

  assert.equal(result.eligible, true);
  assert.equal(result.resolvedAccount?.uri, "https://new.example/@alice");
  assert.deepEqual(result.moveChain, ["https://old.example/@alice"]);
  assert.deepEqual(seen, [
    "account:https://new.example/@alice",
    "provider:https://new.example/@alice",
    "viewer:https://new.example/@alice"
  ]);
});

test("viewer safety cannot be bypassed by a moved-from account", async () => {
  let viewerIdentity: string | undefined;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:old" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: {
        resolve(reference) {
          if (reference === "acct:old") return { id: "old", uri: "https://old.example/@a", movedTo: "acct:new" };
          if (reference === "acct:new") return { id: "new", uri: "https://new.example/@a", lastActivityAt: "2026-08-09T09:00:00Z" };
          return undefined;
        }
      },
      evaluateResolvedAccountPolicy: allowResolvedAccount
    },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety(context) {
      viewerIdentity = context.resolvedAccount?.uri;
      return { eligible: context.resolvedAccount?.uri !== "https://new.example/@a", evidenceComplete: true };
    },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(viewerIdentity, "https://new.example/@a");
  assert.deepEqual(result.reasonCodes, ["viewer_safety_denied"]);
});

test("platform-applicable account restrictions apply to the resolved current account", async () => {
  let accountPolicyIdentity: string | undefined;
  let downstreamReads = 0;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:old" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: {
        resolve(reference) {
          if (reference === "acct:old") return { id: "old", uri: "https://old.example/@a", movedTo: "acct:new" };
          if (reference === "acct:new") return { id: "new", uri: "https://new.example/@a", lastActivityAt: "2026-08-09T09:00:00Z" };
          return undefined;
        }
      },
      evaluateResolvedAccountPolicy(context) {
        accountPolicyIdentity = context.resolvedAccount.uri;
        return { restrictions: ["not_discoverable", "noindex", "opted_out"] as const, evidenceComplete: true };
      }
    },
    evaluateProviderPolicy: () => { downstreamReads += 1; return { allowed: true, evidenceComplete: true }; },
    evaluateViewerSafety: () => { downstreamReads += 1; return { eligible: true, evidenceComplete: true }; },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(accountPolicyIdentity, "https://new.example/@a");
  assert.equal(downstreamReads, 0);
  assert.deepEqual(result.reasonCodes, ["account_noindex", "account_not_discoverable", "account_opted_out"]);
});

test("an account platform with no applicable restrictions needs no invented feature booleans", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "did:plc:alice" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: { resolve: () => ({ id: "did:plc:alice", uri: "at://did:plc:alice/app.bsky.actor.profile/self", lastActivityAt: "2026-08-09T09:00:00Z" }) },
      evaluateResolvedAccountPolicy: () => ({ restrictions: [], evidenceComplete: true })
    },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasonCodes, ["eligible"]);
});

test("incomplete or malformed resolved-account policy fails closed without private detail leakage", async () => {
  const base = {
    candidate: candidate("account", { nativeId: "acct:a" }),
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  } as const;
  const resolver = { resolve: () => ({ id: "a", uri: "https://social.example/@a", lastActivityAt: "2026-08-09T09:00:00Z" }) };

  const incomplete = await evaluateRecommendationCandidateEligibility({
    ...base,
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver,
      evaluateResolvedAccountPolicy: () => ({ restrictions: [], evidenceComplete: false })
    }
  });
  assert.deepEqual(incomplete.reasonCodes, ["account_policy_incomplete"]);

  const malformed = await evaluateRecommendationCandidateEligibility({
    ...base,
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver,
      evaluateResolvedAccountPolicy: () => ({ restrictions: [], evidenceComplete: true, privateReason: "secret" } as never)
    }
  });
  assert.deepEqual(malformed.reasonCodes, ["account_policy_incomplete"]);
  assert.equal("privateReason" in malformed, false);
});

test("account activity gate is reused and move loops fail closed", async () => {
  const inactive = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:inactive" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: { resolve: () => ({ id: "inactive", uri: "https://social.example/@inactive", lastActivityAt: "2026-01-01T00:00:00Z" }) },
      evaluateResolvedAccountPolicy: allowResolvedAccount
    },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(inactive.reasonCodes, ["account_inactive"]);

  const loop = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:a" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: {
        resolve(reference) {
          return reference === "acct:a"
            ? { id: "a", uri: "https://a.example/@a", movedTo: "acct:b" }
            : { id: "b", uri: "https://b.example/@a", movedTo: "acct:a" };
        }
      },
      evaluateResolvedAccountPolicy: allowResolvedAccount
    },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(loop.reasonCodes, ["account_move_loop"]);
});

test("cheap candidate and identity gates short-circuit account resolution and policy callbacks", async () => {
  let resolverReads = 0;
  let policyReads = 0;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { availability: "unavailable", nativeId: "acct:offline" }),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: { resolve: () => { resolverReads += 1; return undefined; } },
      evaluateResolvedAccountPolicy: () => { policyReads += 1; return allowResolvedAccount(); }
    },
    evaluateProviderPolicy: () => { policyReads += 1; return { allowed: true, evidenceComplete: true }; },
    evaluateViewerSafety: () => { policyReads += 1; return { eligible: true, evidenceComplete: true }; },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(result.reasonCodes, ["candidate_unavailable"]);
  assert.equal(resolverReads, 0);
  assert.equal(policyReads, 0);

  const unbound = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("account", { nativeId: "acct:unbound" }),
    evidence: {
      kind: "account",
      identityBindingVerified: false,
      resolver: { resolve: () => { resolverReads += 1; return undefined; } },
      evaluateResolvedAccountPolicy: allowResolvedAccount
    },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(unbound.reasonCodes, ["identity_verification_required"]);
  assert.equal(resolverReads, 0);
});

test("provider and viewer evaluators fail closed and provider denial short-circuits viewer safety", async () => {
  const providerError = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    evaluateProviderPolicy: () => { throw new Error("private provider error"); },
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(providerError.reasonCodes, ["provider_policy_incomplete"]);

  let viewerReads = 0;
  const denied = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    evaluateProviderPolicy: () => ({ allowed: false, evidenceComplete: true }),
    evaluateViewerSafety: () => { viewerReads += 1; return { eligible: true, evidenceComplete: true }; },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(denied.reasonCodes, ["provider_policy_denied"]);
  assert.equal(viewerReads, 0);

  const viewerMalformed = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: () => ({ eligible: false, evidenceComplete: true, matchedKeywords: ["secret"] } as never),
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(viewerMalformed.reasonCodes, ["viewer_safety_incomplete"]);
});

test("empty moderation state is valid complete safety evidence", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("hashtag"),
    evidence: { kind: "hashtag", normalizedValidPublicTopic: true, locallyFiltered: false },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: () => ({ eligible: true, evidenceComplete: true }),
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
});

test("strong-identity target kinds require authority verification", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("feed", { verification: { state: "source_asserted" } }),
    evidence: { kind: "feed", resolvable: true, available: true },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(result.reasonCodes, ["identity_verification_required"]);
});

test("post publicness and identity binding are mandatory", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("post"),
    evidence: { kind: "post", explicitlyPublic: false, available: true, identityBound: false },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(result.reasonCodes, ["post_identity_unbound", "post_not_public"]);
});

test("unavailable containers stale oversized packs and closed instances fail closed", async () => {
  const feed = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("feed"), evidence: { kind: "feed", resolvable: true, available: false },
    evaluateProviderPolicy: allowProvider, evaluateViewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(feed.reasonCodes, ["feed_unavailable"]);

  const list = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("list"), evidence: { kind: "list", resolvable: false, available: true },
    evaluateProviderPolicy: allowProvider, evaluateViewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(list.reasonCodes, ["list_unresolvable"]);

  const pack = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("starter_pack"), evidence: { kind: "starter_pack", resolvable: true, current: false, available: true, memberCount: 1001 },
    evaluateProviderPolicy: allowProvider, evaluateViewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(pack.reasonCodes, ["starter_pack_members_unbounded", "starter_pack_stale"]);

  const instance = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("instance"), evidence: { kind: "instance", healthy: true, registrationOpen: false, policyEligible: true },
    evaluateProviderPolicy: allowProvider, evaluateViewerSafety: allowViewer, evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.deepEqual(instance.reasonCodes, ["instance_registration_closed"]);
});

test("labeler eligibility never implies subscription", async () => {
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("labeler"),
    evidence: { kind: "labeler", identityVerified: true, available: true, policyEligible: true },
    evaluateProviderPolicy: allowProvider,
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z"
  });
  assert.equal(result.eligible, true);
  assert.equal("subscribed" in result, false);
  assert.equal("subscription" in result, false);
});

test("policy context carries cancellation without exposing unrelated state", async () => {
  const controller = new AbortController();
  let seenContext: RecommendationCandidatePolicyEvaluationContext | undefined;
  const result = await evaluateRecommendationCandidateEligibility({
    candidate: candidate("topic"),
    evidence: evidence("topic"),
    evaluateProviderPolicy(context) {
      seenContext = context;
      return { allowed: true, evidenceComplete: true };
    },
    evaluateViewerSafety: allowViewer,
    evaluatedAt: "2026-08-09T10:00:00Z",
    signal: controller.signal
  });
  assert.equal(result.eligible, true);
  assert.equal(seenContext?.signal, controller.signal);
  assert.equal("profile" in (seenContext as object), false);
  assert.equal("subjectId" in (seenContext as object), false);
});
