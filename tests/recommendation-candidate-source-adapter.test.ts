import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCandidateId,
  type RecommendationCandidate
} from "../src/recommendation/candidate-domain.js";
import {
  isRecommendationCandidateSourceAdapter,
  normalizeRecommendationCandidateSourceAdapterReadRequest,
  normalizeRecommendationCandidateSourceAdapterReadResult,
  readRecommendationCandidateSourceAdapter,
  type RecommendationCandidateSourceAdapter
} from "../src/recommendation/candidate-source-adapter.js";

function atprotoFeed(
  verification: RecommendationCandidate["verification"] = { state: "unverified_hint" },
  provenance: RecommendationCandidate["provenance"] = [{
    kind: "third_party_directory_hint",
    sourceId: "directory.example",
    observedAt: "2026-08-08T12:00:00Z",
    trustBoundary: "third_party"
  }]
): RecommendationCandidate {
  const kind = "feed" as const;
  const protocol = "atproto" as const;
  const nativeId = "at://did:plc:example/app.bsky.feed.generator/news";
  return {
    candidateId: createRecommendationCandidateId({ kind, protocol, nativeId, provider: "bsky.app" }),
    kind,
    protocol,
    nativeId,
    provider: "bsky.app",
    verification,
    availability: "unknown",
    observedAt: "2026-08-08T12:00:00Z",
    metadata: {
      canonicalInterestIds: ["technology.news"],
      tags: ["news"],
      entityIds: [],
      languages: ["en"]
    },
    provenance
  };
}

function adapter(
  overrides: Partial<RecommendationCandidateSourceAdapter> = {}
): RecommendationCandidateSourceAdapter {
  return {
    id: "candidate-source.test",
    protocols: ["atproto"],
    candidateKinds: ["feed"],
    authority: "untrusted_hint",
    capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints"],
    read: () => ({ candidates: [atprotoFeed()] }),
    ...overrides
  };
}

const request = {
  requestId: "request-1",
  candidateKinds: ["feed"] as const,
  canonicalInterestIds: ["technology.news"]
};

test("candidate source request is bounded, deduplicated, and presentation-neutral", () => {
  const normalized = normalizeRecommendationCandidateSourceAdapterReadRequest({
    ...request,
    languages: ["en", "es"],
    limit: 20
  });
  assert.deepEqual(normalized.candidateKinds, ["feed"]);
  assert.deepEqual(normalized.canonicalInterestIds, ["technology.news"]);
  assert.equal(normalized.limit, 20);
  assert.ok(Object.isFrozen(normalized));

  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadRequest({
      ...request,
      canonicalInterestIds: ["technology.news", "technology.news"]
    }),
    /interests/u
  );
});

test("untrusted sources cannot claim authoritative verification capability", () => {
  assert.equal(isRecommendationCandidateSourceAdapter(adapter()), true);
  assert.equal(isRecommendationCandidateSourceAdapter(adapter({
    capabilities: [
      "discover",
      "returns_untrusted_hints",
      "returns_authority_verified_identity"
    ]
  })), false);
});

test("untrusted source results cannot promote hints to authority-verified candidates", () => {
  const source = adapter();
  const verified = atprotoFeed(
    {
      state: "authority_verified",
      authority: "did:plc:example",
      verifiedAt: "2026-08-08T12:00:00Z"
    },
    [{
      kind: "provider_discovery",
      sourceId: "atproto.native",
      observedAt: "2026-08-08T12:00:00Z",
      trustBoundary: "same_provider"
    }]
  );

  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, {
      candidates: [verified]
    }),
    /verification exceeds source adapter authority/u
  );
});

test("protocol-native source may return authority-verified identities when declared", () => {
  const source = adapter({
    authority: "protocol_native",
    capabilities: [
      "discover",
      "returns_public_metadata",
      "returns_authority_verified_identity"
    ],
    read: () => ({
      candidates: [atprotoFeed(
        {
          state: "authority_verified",
          authority: "did:plc:example",
          verifiedAt: "2026-08-08T12:00:00Z"
        },
        [{
          kind: "provider_discovery",
          sourceId: "atproto.native",
          observedAt: "2026-08-08T12:00:00Z",
          trustBoundary: "same_provider"
        }]
      )]
    })
  });
  const result = normalizeRecommendationCandidateSourceAdapterReadResult(
    source,
    request,
    source.read(request)
  );
  assert.equal(result.candidates[0]?.verification.state, "authority_verified");
});

test("source results reject undeclared protocols, candidate kinds, and duplicate identities", () => {
  const source = adapter();
  const feed = atprotoFeed();
  const accountNativeId = "did:plc:account";
  const account: RecommendationCandidate = {
    ...feed,
    candidateId: createRecommendationCandidateId({
      kind: "account",
      protocol: "atproto",
      nativeId: accountNativeId,
      provider: "bsky.app"
    }),
    kind: "account",
    nativeId: accountNativeId
  };

  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, {
      candidates: [account]
    }),
    /kind is not declared/u
  );

  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, {
      candidates: [feed, feed]
    }),
    /duplicate candidate identity/u
  );
});

test("pagination cursors require an explicit capability and result count respects the request limit", () => {
  const source = adapter();
  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, {
      candidates: [atprotoFeed()],
      cursor: "next"
    }),
    /without pagination capability/u
  );

  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(
      source,
      { ...request, limit: 1 },
      { candidates: [atprotoFeed(), atprotoFeed()] }
    ),
    /exceeds requested limit/u
  );
});

test("abort propagation is explicit and fail-closed when an adapter does not support it", async () => {
  const controller = new AbortController();
  await assert.rejects(
    () => readRecommendationCandidateSourceAdapter(adapter(), {
      ...request,
      signal: controller.signal
    }),
    /does not declare abort support/u
  );

  const abortingSource = adapter({
    capabilities: [
      "discover",
      "returns_public_metadata",
      "returns_untrusted_hints",
      "supports_abort"
    ]
  });
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    () => readRecommendationCandidateSourceAdapter(abortingSource, {
      ...request,
      signal: controller.signal
    }),
    /cancelled/u
  );
});

test("read wrapper validates results returned by adapters", async () => {
  const source = adapter({
    read: () => ({ candidates: [atprotoFeed()], cursor: "next" })
  });
  await assert.rejects(
    () => readRecommendationCandidateSourceAdapter(source, request),
    /without pagination capability/u
  );
});
