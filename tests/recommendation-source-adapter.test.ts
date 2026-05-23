import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationConsentRequestFromSource,
  evaluateRecommendationFediverseEligibility,
  isRecommendationSourceAdapter,
  isRecommendationSourceItem,
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceAdapterReadResult,
  normalizeRecommendationSourceItem,
  readRecommendationSourceAdapter,
  type RecommendationSourceAdapter,
  type RecommendationSourceItem
} from "../src/index.js";

const sourceItem: RecommendationSourceItem = {
  kind: "post",
  context: {
    protocol: "activitypub",
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship",
    containsPrivateData: true,
    containsThirdPartyData: false,
    serverSideProcessing: true,
    providerPolicyAllowsProcessing: true
  },
  provenance: {
    adapterId: "activitypub-test",
    sourceSystem: "test-fediverse",
    observedAt: "2026-05-15T00:00:00.000Z",
    trustBoundary: "remote_provider",
    opaqueSourceId: "opaque-1"
  }
};

test("source items require protocol, visibility, access, and provenance metadata", () => {
  assert.equal(isRecommendationSourceItem(sourceItem), true);
  assert.equal(isRecommendationSourceItem({ ...sourceItem, context: { ...sourceItem.context, accessBasis: "bad" } }), false);
  assert.equal(isRecommendationSourceItem({ ...sourceItem, provenance: { ...sourceItem.provenance, adapterId: "" } }), false);
  assert.equal(isRecommendationSourceItem({ ...sourceItem, context: { ...sourceItem.context, serverSideProcessing: "true" } }), false);
});

test("normalizing a source item freezes cloned metadata", () => {
  const normalized = normalizeRecommendationSourceItem(sourceItem);

  assert.notEqual(normalized, sourceItem);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.context), true);
  assert.equal(Object.isFrozen(normalized.provenance), true);
  assert.deepEqual(normalized, sourceItem);
});

test("source item metadata maps into consent request without source identifiers", () => {
  const request = createRecommendationConsentRequestFromSource({
    subjectId: "did:web:alice.example",
    dataUse: "ranking",
    source: sourceItem
  });
  const serialized = JSON.stringify(request);

  assert.equal(request.subjectId, "did:web:alice.example");
  assert.equal(request.dataUse, "ranking");
  assert.equal(request.protocol, "activitypub");
  assert.equal(request.sourceVisibility, "followers_only");
  assert.equal(request.accessBasis, "follower_relationship");
  assert.equal(request.containsPrivateData, true);
  assert.equal(request.serverSideProcessing, true);
  assert.equal(serialized.includes("opaque-1"), false);
  assert.equal(serialized.includes("test-fediverse"), false);
});

test("source consent request bridge rejects malformed data uses", () => {
  assert.throws(
    () =>
      createRecommendationConsentRequestFromSource({
        subjectId: "did:web:alice.example",
        dataUse: "raw_profile_export" as never,
        source: sourceItem
      }),
    TypeError
  );
});

test("adapter read requests reject malformed pagination inputs", () => {
  const normalized = normalizeRecommendationSourceAdapterReadRequest({
    subjectId: "subject-1",
    since: "2026-05-15T00:00:00.000Z",
    cursor: "cursor-1",
    limit: 10
  });

  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalized.limit, 10);
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", limit: 0 }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", cursor: "" }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", limit: "10" }),
    TypeError
  );
});

test("adapter read results reject malformed source items", () => {
  const result = normalizeRecommendationSourceAdapterReadResult({
    items: [sourceItem],
    cursor: "next-cursor"
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, "next-cursor");
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadResult({ items: [{ ...sourceItem, kind: "unknown-kind" }] }),
    TypeError
  );
});

test("source adapters expose stable identity, protocol, capabilities, and validated reads", async () => {
  const adapter: RecommendationSourceAdapter = {
    id: "activitypub-test",
    protocol: "activitypub",
    capabilities: ["read_public", "read_private_with_authorization"],
    read(request) {
      assert.equal(Object.isFrozen(request), true);
      assert.equal(request.subjectId, "subject-1");
      return { items: [sourceItem] };
    }
  };

  const result = await readRecommendationSourceAdapter(adapter, { subjectId: "subject-1", limit: 1 });

  assert.equal(isRecommendationSourceAdapter(adapter), true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "post");
});

test("source adapter validation rejects unknown protocol and capabilities", () => {
  assert.equal(
    isRecommendationSourceAdapter({
      id: "bad",
      protocol: "unknown-protocol",
      capabilities: ["read_public"],
      read() {
        return { items: [] };
      }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceAdapter({
      id: "bad",
      protocol: "activitypub",
      capabilities: ["unsafe_raw_read"],
      read() {
        return { items: [] };
      }
    }),
    false
  );
});

test("Fediverse recommendation eligibility allows normalized public discoverable accounts", () => {
  const result = evaluateRecommendationFediverseEligibility({
    account: {
      acct: "@Alice@Example.COM",
      discoverable: true,
      indexable: true
    },
    instance: {
      domain: " example.com "
    }
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "eligible");
  assert.equal(result.normalizedAccountDomain, "example.com");
  assert.equal(result.normalizedInstanceDomain, "example.com");
  assert.equal(result.matchedOptOutTagCount, 0);
});

test("Fediverse recommendation eligibility denies non-discoverable, non-indexable, and explicit noindex accounts", () => {
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", indexable: true }
    }).reason,
    "excluded.account_discoverable_false"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: false, indexable: true },
      policy: { requireDiscoverable: false }
    }).reason,
    "excluded.account_discoverable_false"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: false }
    }).reason,
    "excluded.account_indexable_false"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: true, noindex: true }
    }).reason,
    "excluded.account_noindex_true"
  );
});

test("Fediverse recommendation eligibility respects account opt-out tags", () => {
  const result = evaluateRecommendationFediverseEligibility({
    account: {
      acct: "alice@example.com",
      discoverable: true,
      indexable: true,
      profileTags: ["#" + "no" + "ai", "#NoIndex", "#NoScraping", "#Robotxt", "#!!!"]
    }
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "excluded.account_opt_out_tag");
  assert.equal(result.matchedOptOutTagCount, 4);
});

test("Fediverse recommendation eligibility applies instance and provider denial policy", () => {
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: true },
      policy: { providerAllowsRecommendation: false }
    }).reason,
    "excluded.provider_policy"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: true },
      instance: {
        domain: "example.com",
        policyMatches: [{ provider: "oliphant", tier: "tier0" }]
      }
    }).reason,
    "excluded.instance_policy.oliphant_tier0"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: true },
      instance: {
        domain: "example.com",
        policyMatches: [{ provider: "custom" }]
      }
    }).reason,
    "excluded.instance_policy.custom"
  );
});

test("Fediverse recommendation eligibility applies viewer account and domain controls", () => {
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { actorUri: "https://example.com/users/alice", acct: "alice@example.com", discoverable: true, indexable: true },
      viewerControls: { blockedAccounts: ["https://example.com/users/alice"] }
    }).reason,
    "excluded.viewer_blocked_account"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@example.com", discoverable: true, indexable: true },
      viewerControls: { mutedAccounts: ["alice@example.com"] }
    }).reason,
    "excluded.viewer_muted_account"
  );
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@social.example.com", discoverable: true, indexable: true },
      viewerControls: { blockedDomains: ["example.com"] }
    }).reason,
    "excluded.viewer_blocked_domain"
  );
});

test("Fediverse recommendation eligibility rejects malformed and conflicting identity inputs", () => {
  assert.throws(
    () => evaluateRecommendationFediverseEligibility({ account: { acct: "alice@example.com", domain: "other.example" } }),
    /Conflicting Fediverse recommendation account domains/u
  );
  assert.throws(
    () => evaluateRecommendationFediverseEligibility({ account: { acct: "alice@example.com" }, instance: { domain: "other.example" } }),
    /Conflicting Fediverse recommendation instance domain/u
  );
  assert.throws(
    () => evaluateRecommendationFediverseEligibility({ account: { acct: "alice@http://example.com" } }),
    TypeError
  );
  assert.throws(
    () => evaluateRecommendationFediverseEligibility({ account: { actorUri: "urn:fediverse:test" } }),
    TypeError
  );
});
