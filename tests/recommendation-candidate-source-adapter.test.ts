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
  type RecommendationCandidateSourceAdapter,
  type RecommendationCandidateSourceAdapterQuery
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

function adapter(overrides: Partial<RecommendationCandidateSourceAdapter> = {}): RecommendationCandidateSourceAdapter {
  return {
    id: "candidate-source.test",
    protocols: ["atproto"],
    candidateKinds: ["feed"],
    authority: "untrusted_hint",
    transport: "remote",
    privacy: {
      sourceVisibility: "atproto_public_repo",
      accessBasis: "atproto_public_repo",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: true,
      providerPolicyAllowsProcessing: true
    },
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

test("candidate source request is bounded, duplicate-free, and closed", () => {
  const normalized = normalizeRecommendationCandidateSourceAdapterReadRequest({ ...request, languages: ["en", "es"], limit: 20 });
  assert.equal(normalized.limit, 20);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadRequest({ ...request, canonicalInterestIds: ["technology.news", "technology.news"] }), /interests/u);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadRequest({ ...request, subjectId: "alice" }), /unsupported context/u);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadRequest({ ...request, profile: { interests: ["private"] } }), /unsupported context/u);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadRequest({ ...request, privateFilters: ["blocked.example"] }), /unsupported context/u);
});

test("remote adapters receive a redacted purpose-limited query", async () => {
  let seen: RecommendationCandidateSourceAdapterQuery | undefined;
  const source = adapter({
    read: (query) => {
      seen = query;
      return { candidates: [atprotoFeed()] };
    }
  });
  await readRecommendationCandidateSourceAdapter(source, {
    ...request,
    requestId: "subject-alice",
    languages: ["en"]
  });
  assert.ok(seen);
  assert.notEqual(seen.requestId, "subject-alice");
  assert.match(seen.requestId, /^candidate-query:v1:[0-9a-f]{64}$/u);
  assert.equal(seen.canonicalInterestIds, undefined);
  assert.equal(seen.languages, undefined);
});

test("local adapters may receive bounded profile-derived discovery terms", async () => {
  let seen: RecommendationCandidateSourceAdapterQuery | undefined;
  const source = adapter({
    transport: "local",
    authority: "curated_public",
    privacy: {
      sourceVisibility: "local_only",
      accessBasis: "owner",
      containsPrivateData: false,
      containsThirdPartyData: false,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    },
    capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints"],
    read: (query) => {
      seen = query;
      return { candidates: [atprotoFeed()] };
    }
  });
  await readRecommendationCandidateSourceAdapter(source, { ...request, languages: ["en"] });
  assert.deepEqual(seen?.canonicalInterestIds, ["technology.news"]);
  assert.deepEqual(seen?.languages, ["en"]);
});

test("remote source privacy and provider policy fail closed", async () => {
  assert.equal(isRecommendationCandidateSourceAdapter(adapter({
    privacy: {
      sourceVisibility: "followers_only",
      accessBasis: "authenticated_api",
      containsPrivateData: true,
      containsThirdPartyData: true,
      serverSideProcessing: true,
      providerPolicyAllowsProcessing: true
    }
  })), false);
  assert.equal(isRecommendationCandidateSourceAdapter(adapter({
    privacy: {
      sourceVisibility: "public",
      accessBasis: "public_web",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: true,
      providerPolicyAllowsProcessing: false
    }
  })), false);

  let reads = 0;
  const source = adapter({
    evaluateProviderPolicy: () => false,
    read: () => {
      reads += 1;
      return { candidates: [atprotoFeed()] };
    }
  });
  await assert.rejects(() => readRecommendationCandidateSourceAdapter(source, request), /provider policy denies/u);
  assert.equal(reads, 0);
});

test("untrusted sources cannot claim authoritative verification capability", () => {
  assert.equal(isRecommendationCandidateSourceAdapter(adapter()), true);
  assert.equal(isRecommendationCandidateSourceAdapter(adapter({ capabilities: ["discover", "returns_untrusted_hints", "returns_authority_verified_identity"] })), false);
});

test("untrusted source results cannot promote hints to authority-verified candidates", () => {
  const source = adapter();
  const verified = atprotoFeed(
    { state: "authority_verified", authority: "did:plc:example", verifiedAt: "2026-08-08T12:00:00Z" },
    [{ kind: "provider_discovery", sourceId: "atproto.native", observedAt: "2026-08-08T12:00:00Z", trustBoundary: "same_provider" }]
  );
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, { candidates: [verified] }), /verification exceeds source adapter authority/u);
});

test("unverified hints require the declared hint capability", () => {
  const source = adapter({
    authority: "curated_public",
    capabilities: ["discover", "returns_public_metadata"]
  });
  assert.throws(
    () => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, { candidates: [atprotoFeed()] }),
    /hint exceeds declared adapter capabilities/u
  );
});

test("protocol-native source may return authority-verified identities when declared", () => {
  const source = adapter({
    authority: "protocol_native",
    capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"],
    read: () => ({ candidates: [atprotoFeed(
      { state: "authority_verified", authority: "did:plc:example", verifiedAt: "2026-08-08T12:00:00Z" },
      [{ kind: "provider_discovery", sourceId: "atproto.native", observedAt: "2026-08-08T12:00:00Z", trustBoundary: "same_provider" }]
    )] })
  });
  const result = normalizeRecommendationCandidateSourceAdapterReadResult(source, request, source.read(request));
  assert.equal(result.candidates[0]?.verification.state, "authority_verified");
});

test("source results reject undeclared kinds and duplicate identities", () => {
  const source = adapter();
  const feed = atprotoFeed();
  const nativeId = "did:plc:account";
  const account: RecommendationCandidate = {
    ...feed,
    candidateId: createRecommendationCandidateId({ kind: "account", protocol: "atproto", nativeId, provider: "bsky.app" }),
    kind: "account",
    nativeId
  };
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, { candidates: [account] }), /kind is not declared/u);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, { candidates: [feed, feed] }), /duplicate candidate identity/u);
});

test("pagination capability is enforced before reads and on returned cursors", async () => {
  const source = adapter();
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadResult(source, request, { candidates: [atprotoFeed()], cursor: "next" }), /without pagination capability/u);
  assert.throws(() => normalizeRecommendationCandidateSourceAdapterReadResult(source, { ...request, limit: 1 }, { candidates: [atprotoFeed(), atprotoFeed()] }), /exceeds requested limit/u);

  let reads = 0;
  const noPagination = adapter({ read: () => { reads += 1; return { candidates: [atprotoFeed()] }; } });
  await assert.rejects(() => readRecommendationCandidateSourceAdapter(noPagination, { ...request, cursor: "page-2" }), /does not declare pagination support/u);
  assert.equal(reads, 0);
});

test("abort propagation is explicit", async () => {
  const controller = new AbortController();
  await assert.rejects(() => readRecommendationCandidateSourceAdapter(adapter(), { ...request, signal: controller.signal }), /does not declare abort support/u);
  const abortingSource = adapter({ capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints", "supports_abort"] });
  controller.abort(new Error("cancelled"));
  await assert.rejects(() => readRecommendationCandidateSourceAdapter(abortingSource, { ...request, signal: controller.signal }), /cancelled/u);
});

test("read wrapper validates adapter results", async () => {
  const source = adapter({ read: () => ({ candidates: [atprotoFeed()], cursor: "next" }) });
  await assert.rejects(() => readRecommendationCandidateSourceAdapter(source, request), /without pagination capability/u);
});
