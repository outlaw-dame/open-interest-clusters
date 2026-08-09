import assert from "node:assert/strict";
import test from "node:test";

import { createRecommendationCandidateId, type RecommendationCandidate } from "../src/recommendation/candidate-domain.js";
import { evaluateRecommendationCandidateEligibility } from "../src/recommendation/candidate-eligibility.js";

function topicCandidate(): RecommendationCandidate {
  const kind = "topic" as const;
  const protocol = "activitypub" as const;
  const nativeId = "topic:technology";
  const provider = "catalog.local";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification: { state: "source_asserted" },
    availability: "available",
    observedAt: "2026-08-09T10:00:00Z",
    metadata: { canonicalInterestIds: ["technology"], tags: [], entityIds: [], languages: [] },
    provenance: [{
      kind: "local_catalog",
      sourceId: "catalog.local",
      observedAt: "2026-08-09T10:00:00Z",
      trustBoundary: "same_provider"
    }]
  };
}

function accountCandidate(): RecommendationCandidate {
  const kind = "account" as const;
  const protocol = "activitypub" as const;
  const nativeId = "acct:alice";
  const provider = "social.example";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider }),
    kind,
    protocol,
    nativeId,
    provider,
    verification: { state: "source_asserted" },
    availability: "available",
    observedAt: "2026-08-09T10:00:00Z",
    metadata: { canonicalInterestIds: [], tags: [], entityIds: [], languages: [] },
    provenance: [{
      kind: "provider_discovery",
      sourceId: "social.example",
      observedAt: "2026-08-09T10:00:00Z",
      trustBoundary: "same_provider"
    }]
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("cancellation after a provider-policy await prevents viewer-safety evaluation", async () => {
  const controller = new AbortController();
  const pending = deferred<{ allowed: boolean; evidenceComplete: boolean }>();
  let viewerReads = 0;
  const evaluation = evaluateRecommendationCandidateEligibility({
    candidate: topicCandidate(),
    evidence: { kind: "topic", canonicalCatalogIdentity: true, policySafeMetadata: true },
    evaluateProviderPolicy: () => pending.promise,
    evaluateViewerSafety: () => { viewerReads += 1; return { eligible: true, evidenceComplete: true }; },
    evaluatedAt: "2026-08-09T10:05:00Z",
    signal: controller.signal
  });

  controller.abort(new Error("cancel-provider"));
  pending.resolve({ allowed: true, evidenceComplete: true });
  await assert.rejects(evaluation, /cancel-provider/u);
  assert.equal(viewerReads, 0);
});

test("cancellation after a viewer-safety await cannot return an eligible result", async () => {
  const controller = new AbortController();
  const pending = deferred<{ eligible: boolean; evidenceComplete: boolean }>();
  const evaluation = evaluateRecommendationCandidateEligibility({
    candidate: topicCandidate(),
    evidence: { kind: "topic", canonicalCatalogIdentity: true, policySafeMetadata: true },
    evaluateProviderPolicy: () => ({ allowed: true, evidenceComplete: true }),
    evaluateViewerSafety: () => pending.promise,
    evaluatedAt: "2026-08-09T10:05:00Z",
    signal: controller.signal
  });

  controller.abort(new Error("cancel-viewer"));
  pending.resolve({ eligible: true, evidenceComplete: true });
  await assert.rejects(evaluation, /cancel-viewer/u);
});

test("cancellation after resolved-account policy await stops downstream policy work", async () => {
  const controller = new AbortController();
  const pending = deferred<{ discoverable: boolean; noindex: boolean; optedOut: boolean; evidenceComplete: boolean }>();
  let providerReads = 0;
  const evaluation = evaluateRecommendationCandidateEligibility({
    candidate: accountCandidate(),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: {
        resolve: () => ({
          id: "alice",
          uri: "https://social.example/@alice",
          lastActivityAt: "2026-08-09T09:00:00Z"
        })
      },
      evaluateResolvedAccountPolicy: () => pending.promise
    },
    evaluateProviderPolicy: () => { providerReads += 1; return { allowed: true, evidenceComplete: true }; },
    evaluateViewerSafety: () => ({ eligible: true, evidenceComplete: true }),
    evaluatedAt: "2026-08-09T10:05:00Z",
    signal: controller.signal
  });

  await Promise.resolve();
  controller.abort(new Error("cancel-account-policy"));
  pending.resolve({ discoverable: true, noindex: false, optedOut: false, evidenceComplete: true });
  await assert.rejects(evaluation, /cancel-account-policy/u);
  assert.equal(providerReads, 0);
});

test("cancellation after account resolver await stops resolved-account policy work", async () => {
  const controller = new AbortController();
  const pending = deferred<{
    id: string;
    uri: string;
    lastActivityAt: string;
  }>();
  let accountPolicyReads = 0;
  const evaluation = evaluateRecommendationCandidateEligibility({
    candidate: accountCandidate(),
    evidence: {
      kind: "account",
      identityBindingVerified: true,
      resolver: { resolve: () => pending.promise },
      evaluateResolvedAccountPolicy: () => {
        accountPolicyReads += 1;
        return { discoverable: true, noindex: false, optedOut: false, evidenceComplete: true };
      }
    },
    evaluateProviderPolicy: () => ({ allowed: true, evidenceComplete: true }),
    evaluateViewerSafety: () => ({ eligible: true, evidenceComplete: true }),
    evaluatedAt: "2026-08-09T10:05:00Z",
    signal: controller.signal
  });

  controller.abort(new Error("cancel-resolver"));
  pending.resolve({ id: "alice", uri: "https://social.example/@alice", lastActivityAt: "2026-08-09T09:00:00Z" });
  await assert.rejects(evaluation, /cancel-resolver/u);
  assert.equal(accountPolicyReads, 0);
});
