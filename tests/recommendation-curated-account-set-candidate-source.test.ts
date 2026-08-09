import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationCuratedAccountSetCandidateSourceAdapter,
  readRecommendationCandidateSourceAdapter,
  type RecommendationCuratedAccountSet
} from "../src/index.js";

const OBSERVED_AT = "2026-08-09T10:00:00.000Z";

function set(overrides: Partial<RecommendationCuratedAccountSet> = {}): RecommendationCuratedAccountSet {
  return {
    provider: "mastodon_collection",
    id: "collection-1",
    url: "https://social.example/collections/collection-1",
    curatorId: "curator-1",
    curatorUri: "https://social.example/@curator",
    name: "PlayStation people",
    discoverable: true,
    sensitive: false,
    observedAt: OBSERVED_AT,
    hashtags: ["playstation", "gaming"],
    members: [
      {
        accountId: "account-1",
        accountUri: "https://social.example/users/alice",
        handle: "alice@social.example",
        state: "accepted"
      }
    ],
    trustBoundary: "same_provider",
    membershipComplete: true,
    ...overrides
  };
}

test("curated account sets become source-asserted ActivityPub account candidates", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({
    id: "curated.account-sets",
    sets: [set()]
  });

  const result = await readRecommendationCandidateSourceAdapter(adapter, {
    requestId: "curated-read",
    candidateKinds: ["account"],
    canonicalInterestIds: [],
    limit: 10
  });

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.kind, "account");
  assert.equal(candidate.protocol, "activitypub");
  assert.equal(candidate.nativeId, "https://social.example/users/alice");
  assert.equal(candidate.provider, "social.example");
  assert.equal(candidate.verification.state, "source_asserted");
  assert.deepEqual(candidate.metadata.tags, ["gaming", "playstation"]);
  assert.equal(candidate.provenance[0]?.kind, "curated_account_set");
  assert.equal(candidate.provenance[0]?.trustBoundary, "same_provider");
});

test("duplicate members collapse across curated sets while preserving provenance", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({
    id: "curated.account-sets",
    sets: [
      set(),
      set({
        id: "collection-2",
        url: "https://social.example/collections/collection-2",
        hashtags: ["console"],
        trustBoundary: "remote_provider"
      })
    ]
  });

  const result = await readRecommendationCandidateSourceAdapter(adapter, {
    requestId: "curated-dedupe",
    candidateKinds: ["account"],
    canonicalInterestIds: [],
    limit: 10
  });

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0]?.metadata.tags, ["console", "gaming", "playstation"]);
  assert.equal(result.candidates[0]?.provenance.length, 2);
});

test("unsafe or non-actionable curated memberships are omitted", async () => {
  const adapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({
    id: "curated.account-sets",
    sets: [
      set({ sensitive: true }),
      set({ id: "hidden", discoverable: false }),
      set({
        id: "membership-states",
        members: [
          { accountId: "pending", accountUri: "https://social.example/users/pending", state: "pending" },
          { accountId: "unknown-uri", state: "accepted" },
          { accountId: "accepted", accountUri: "https://social.example/users/bob", state: "accepted" }
        ]
      })
    ]
  });

  const result = await readRecommendationCandidateSourceAdapter(adapter, {
    requestId: "curated-safety",
    candidateKinds: ["account"],
    canonicalInterestIds: [],
    limit: 10
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.nativeId), ["https://social.example/users/bob"]);
});
