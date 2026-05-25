import test from "node:test";
import assert from "node:assert/strict";

import {
  RecommendationConsentDeniedError,
  readRecommendationSourceAdapterWithConsent,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentPolicy,
  type RecommendationSourceAdapter,
  type RecommendationSourceItem
} from "../src/index.js";
import { assertSerializedPayloadRedaction } from "./helpers/privacy-redaction.js";

const publicSourceItem: RecommendationSourceItem = {
  kind: "post",
  context: {
    protocol: "activitypub",
    sourceVisibility: "public",
    accessBasis: "public_web",
    containsPrivateData: false
  },
  provenance: {
    adapterId: "activitypub-test",
    sourceSystem: "test-fediverse",
    observedAt: "2026-05-15T00:00:00.000Z",
    trustBoundary: "remote_provider",
    opaqueSourceId: "opaque-public"
  }
};

const privateSourceItem: RecommendationSourceItem = {
  kind: "post",
  context: {
    protocol: "activitypub",
    sourceVisibility: "followers_only",
    accessBasis: "follower_relationship",
    containsPrivateData: true
  },
  provenance: {
    adapterId: "activitypub-test",
    sourceSystem: "test-fediverse",
    observedAt: "2026-05-15T00:00:01.000Z",
    trustBoundary: "remote_provider",
    opaqueSourceId: "opaque-private"
  }
};

const rankingPolicy: RecommendationConsentPolicy = {
  subjectId: "subject-1",
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"]
};

const publicOnlyPolicy: RecommendationConsentPolicy = {
  subjectId: "subject-1",
  allowedDataUses: ["ranking"]
};

function createAdapter(items: readonly RecommendationSourceItem[]): RecommendationSourceAdapter {
  return {
    id: "activitypub-test",
    protocol: "activitypub",
    capabilities: ["read_public", "read_private_with_authorization"],
    read(request) {
      assert.equal(Object.isFrozen(request), true);
      assert.equal(request.subjectId, "subject-1");
      return { items, cursor: "next-cursor" };
    }
  };
}

test("consent-gated source reads return only consent-allowed items", async () => {
  const auditEvents: PrivacySafeRecommendationConsentEvent[] = [];
  const result = await readRecommendationSourceAdapterWithConsent({
    adapter: createAdapter([publicSourceItem, privateSourceItem]),
    readRequest: { subjectId: "subject-1", limit: 2 },
    dataUse: "ranking",
    policy: rankingPolicy,
    enforcementOptions: {
      auditSink: {
        record(event) {
          auditEvents.push(event);
        }
      }
    }
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.consentEvaluations), true);
  assert.equal(result.items.length, 2);
  assert.equal(result.deniedItemCount, 0);
  assert.equal(result.cursor, "next-cursor");
  assert.equal(result.consentEvaluations.every((evaluation) => evaluation.decision === "allow"), true);
  assert.equal(auditEvents.length, 2);
  assertSerializedPayloadRedaction(auditEvents, ["opaque-public", "activitypub-test"]);
});

test("consent-gated source reads fail closed by default when any item is denied", async () => {
  let thrown: unknown;

  try {
    await readRecommendationSourceAdapterWithConsent({
      adapter: createAdapter([privateSourceItem]),
      readRequest: { subjectId: "subject-1" },
      dataUse: "ranking",
      policy: publicOnlyPolicy
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown instanceof RecommendationConsentDeniedError, true);
  assert.equal((thrown as RecommendationConsentDeniedError).reason, "safety.deny.private_data_use_not_allowed");
});

test("consent-gated source reads can filter denied items without returning them", async () => {
  const auditEvents: PrivacySafeRecommendationConsentEvent[] = [];
  const result = await readRecommendationSourceAdapterWithConsent({
    adapter: createAdapter([publicSourceItem, privateSourceItem]),
    readRequest: { subjectId: "subject-1" },
    dataUse: "ranking",
    policy: publicOnlyPolicy,
    deniedItemMode: "filter_denied",
    enforcementOptions: {
      auditSink: {
        record(event) {
          auditEvents.push(event);
        }
      }
    }
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], publicSourceItem);
  assert.equal(result.deniedItemCount, 1);
  assert.equal(result.consentEvaluations.length, 1);
  assert.equal(result.consentEvaluations[0]?.decision, "allow");
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents.some((event) => event.decision === "deny"), true);
  assertSerializedPayloadRedaction(result, ["opaque-private"]);
});

test("filter-denied source reads prioritize denial errors when denial audit fails", async () => {
  let thrown: unknown;

  try {
    await readRecommendationSourceAdapterWithConsent({
      adapter: createAdapter([privateSourceItem]),
      readRequest: { subjectId: "subject-1" },
      dataUse: "ranking",
      policy: publicOnlyPolicy,
      deniedItemMode: "filter_denied",
      enforcementOptions: {
        auditSink: {
          record() {
            throw new Error("sink unavailable");
          }
        }
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown instanceof RecommendationConsentDeniedError, true);
  assert.equal((thrown as RecommendationConsentDeniedError).reason, "safety.deny.private_data_use_not_allowed");
});

test("filter-denied source reads may ignore audit failures only when explicitly configured", async () => {
  const result = await readRecommendationSourceAdapterWithConsent({
    adapter: createAdapter([privateSourceItem]),
    readRequest: { subjectId: "subject-1" },
    dataUse: "ranking",
    policy: publicOnlyPolicy,
    deniedItemMode: "filter_denied",
    enforcementOptions: {
      auditFailureMode: "ignore",
      auditSink: {
        record() {
          throw new Error("sink unavailable");
        }
      }
    }
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.deniedItemCount, 1);
  assert.equal(result.consentEvaluations.length, 0);
});

test("consent-gated source reads short-circuit missing consent before adapter reads", async () => {
  let readCalled = false;
  const adapter: RecommendationSourceAdapter = {
    id: "activitypub-test",
    protocol: "activitypub",
    capabilities: ["read_public"],
    read() {
      readCalled = true;
      return { items: [publicSourceItem] };
    }
  };
  let thrown: unknown;

  try {
    await readRecommendationSourceAdapterWithConsent({
      adapter,
      readRequest: { subjectId: "subject-1" },
      dataUse: "ranking",
      policy: undefined,
      deniedItemMode: "filter_denied"
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(readCalled, false);
  assert.equal(thrown instanceof RecommendationConsentDeniedError, true);
  assert.equal((thrown as RecommendationConsentDeniedError).reason, "consent.deny.default");
});

test("consent-gated source reads reject invalid denied item modes", async () => {
  await assert.rejects(
    () =>
      readRecommendationSourceAdapterWithConsent({
        adapter: createAdapter([publicSourceItem]),
        readRequest: { subjectId: "subject-1" },
        dataUse: "ranking",
        policy: rankingPolicy,
        deniedItemMode: "skip" as never
      }),
    TypeError
  );
});

test("consent-gated source reads reject malformed data use before returning source items", async () => {
  await assert.rejects(
    () =>
      readRecommendationSourceAdapterWithConsent({
        adapter: createAdapter([publicSourceItem]),
        readRequest: { subjectId: "subject-1" },
        dataUse: "raw_profile_export" as never,
        policy: rankingPolicy,
        deniedItemMode: "filter_denied"
      }),
    TypeError
  );
});

test("consent-gated source reads reject malformed data use even for empty pages", async () => {
  let readCalled = false;
  const emptyAdapter: RecommendationSourceAdapter = {
    id: "activitypub-test",
    protocol: "activitypub",
    capabilities: ["read_public"],
    read() {
      readCalled = true;
      return { items: [] };
    }
  };

  await assert.rejects(
    () =>
      readRecommendationSourceAdapterWithConsent({
        adapter: emptyAdapter,
        readRequest: { subjectId: "subject-1" },
        dataUse: "raw_profile_export" as never,
        policy: rankingPolicy,
        deniedItemMode: "filter_denied"
      }),
    TypeError
  );
  assert.equal(readCalled, false);
});
