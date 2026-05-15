import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveRecommendationInterestSignals,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation,
  type RecommendationConsentGatedSourceAdapterReadResult,
  type RecommendationSourceItem
} from "../src/index.js";

const consentEvent: PrivacySafeRecommendationConsentEvent = {
  decision: "allow",
  reason: "consent.allow.explicit",
  dataUse: "ranking",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web",
  containsPrivateData: false,
  containsThirdPartyData: false,
  serverSideProcessing: false
};

const consentEvaluation: RecommendationConsentEvaluation = {
  ...consentEvent,
  auditEvent: consentEvent
};

const sourceItem: RecommendationSourceItem = {
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
    opaqueSourceId: "opaque-source-id"
  }
};

function createReadResult(): RecommendationConsentGatedSourceAdapterReadResult {
  return Object.freeze({
    items: Object.freeze([sourceItem]),
    consentEvaluations: Object.freeze([consentEvaluation]),
    deniedItemCount: 1,
    cursor: "next-cursor"
  });
}

test("interest signal derivation emits frozen signals from allowed consent-gated items", () => {
  const result = deriveRecommendationInterestSignals({
    readResult: createReadResult(),
    dataUse: "ranking",
    derivations: [
      {
        sourceIndex: 0,
        target: { kind: "canonical_interest", key: "books.fiction" },
        action: "view",
        polarity: "positive",
        strength: 0.4,
        confidence: 0.7,
        privacyBoundary: "local_only"
      }
    ]
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.signals), true);
  assert.equal(result.signals.length, 1);
  assert.equal(result.sourceItemCount, 1);
  assert.equal(result.derivationCount, 1);
  assert.equal(result.deniedItemCount, 1);
  assert.equal(result.signals[0]?.target.key, "books.fiction");
  assert.equal(result.signals[0]?.consent.decision, "allow");
});

test("interest signal derivation does not copy source provenance identifiers", () => {
  const result = deriveRecommendationInterestSignals({
    readResult: createReadResult(),
    dataUse: "ranking",
    derivations: [
      {
        sourceIndex: 0,
        target: { kind: "keyword", key: "fiction" },
        action: "search",
        strength: 0.5,
        confidence: 0.8
      }
    ]
  });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("opaque-source-id"), false);
  assert.equal(serialized.includes("activitypub-test"), false);
  assert.equal(serialized.includes("test-fediverse"), false);
  assert.equal(serialized.includes("next-cursor"), false);
});

test("interest signal derivation rejects out-of-range source indexes", () => {
  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: createReadResult(),
        dataUse: "ranking",
        derivations: [
          {
            sourceIndex: 1,
            target: { kind: "keyword", key: "fiction" },
            action: "search",
            strength: 0.5,
            confidence: 0.8
          }
        ]
      }),
    TypeError
  );
});

test("interest signal derivation rejects invalid scores and malformed data uses", () => {
  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: createReadResult(),
        dataUse: "ranking",
        derivations: [
          {
            sourceIndex: 0,
            target: { kind: "keyword", key: "fiction" },
            action: "search",
            strength: -0.1,
            confidence: 0.8
          }
        ]
      }),
    TypeError
  );

  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: createReadResult(),
        dataUse: "raw_profile_export" as never,
        derivations: []
      }),
    TypeError
  );
});

test("interest signal derivation rejects mismatched read result arrays", () => {
  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: {
          items: [sourceItem],
          consentEvaluations: [],
          deniedItemCount: 0
        },
        dataUse: "ranking",
        derivations: []
      }),
    TypeError
  );
});

test("interest signal derivation rejects denied consent evaluations", () => {
  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: {
          items: [sourceItem],
          consentEvaluations: [{ ...consentEvaluation, decision: "deny" }],
          deniedItemCount: 0
        },
        dataUse: "ranking",
        derivations: [
          {
            sourceIndex: 0,
            target: { kind: "keyword", key: "fiction" },
            action: "search",
            strength: 0.5,
            confidence: 0.8
          }
        ]
      }),
    TypeError
  );
});

test("interest signal derivation rejects unsafe targets through signal normalization", () => {
  assert.throws(
    () =>
      deriveRecommendationInterestSignals({
        readResult: createReadResult(),
        dataUse: "ranking",
        derivations: [
          {
            sourceIndex: 0,
            target: { kind: "domain", key: "example.com/private/path" },
            action: "click",
            strength: 0.5,
            confidence: 0.8
          }
        ]
      }),
    TypeError
  );
});
