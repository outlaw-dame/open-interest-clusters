import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationConsentRequestFromSource,
  isRecommendationSourceAdapter,
  isRecommendationSourceItem,
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceAdapterReadResult,
  readRecommendationSourceAdapter,
  type RecommendationSourceAdapter,
  type RecommendationSourceItem
} from "../src/index.js";

const validSourceItem: RecommendationSourceItem = {
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

test("source items reject loose timestamps and impossible calendar dates", () => {
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, observedAt: "2026-05-15T00:00:00" }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, observedAt: "2026-02-30T00:00:00.000Z" }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, observedAt: "2026-05-15T00:00:00.000Z" }
    }),
    true
  );
});

test("source items restrict leap-second timestamps to the 59th minute", () => {
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, observedAt: "2026-05-15T12:34:60Z" }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, observedAt: "2026-05-15T12:59:60Z" }
    }),
    true
  );
});

test("source items reject overlong adapter and source identifiers", () => {
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, adapterId: `adapter-${"x".repeat(300)}` }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, opaqueSourceId: `opaque-${"x".repeat(2500)}` }
    }),
    false
  );
});

test("source items reject C0, DEL, and C1 control characters in identifiers", () => {
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, adapterId: `adapter-${String.fromCharCode(10)}` }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, sourceSystem: `source-${String.fromCharCode(127)}` }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceItem({
      ...validSourceItem,
      provenance: { ...validSourceItem.provenance, opaqueSourceId: `opaque-${String.fromCharCode(133)}` }
    }),
    false
  );
});

test("source adapter read requests reject loose since timestamps and oversized cursors", () => {
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", since: "2026-05-16T00:00:00" }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", since: "2026-02-30T00:00:00.000Z" }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", since: "2026-05-16T12:34:60Z" }),
    TypeError
  );
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadRequest({ subjectId: "subject-1", cursor: `cursor-${"x".repeat(1500)}` }),
    TypeError
  );
});

test("source adapter read results reject oversized cursors", () => {
  assert.throws(
    () => normalizeRecommendationSourceAdapterReadResult({ items: [validSourceItem], cursor: `cursor-${"x".repeat(1500)}` }),
    TypeError
  );
});

test("source adapter validation rejects duplicate capabilities and overlong adapter ids", () => {
  assert.equal(
    isRecommendationSourceAdapter({
      id: "activitypub-test",
      protocol: "activitypub",
      capabilities: ["read_public", "read_public"],
      read() {
        return { items: [] };
      }
    }),
    false
  );
  assert.equal(
    isRecommendationSourceAdapter({
      id: `adapter-${"x".repeat(300)}`,
      protocol: "activitypub",
      capabilities: ["read_public"],
      read() {
        return { items: [] };
      }
    }),
    false
  );
});

test("validated reads fail closed when adapters emit malformed provenance", async () => {
  const adapter: RecommendationSourceAdapter = {
    id: "activitypub-test",
    protocol: "activitypub",
    capabilities: ["read_public"],
    read() {
      return {
        items: [
          {
            ...validSourceItem,
            provenance: { ...validSourceItem.provenance, observedAt: "2026-05-15T00:00:00" }
          }
        ]
      };
    }
  };

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "subject-1" }),
    TypeError
  );
});

test("source consent request bridge rejects oversized subject identifiers", () => {
  assert.throws(
    () =>
      createRecommendationConsentRequestFromSource({
        subjectId: `subject-${"x".repeat(2500)}`,
        dataUse: "ranking",
        source: validSourceItem
      }),
    TypeError
  );
});