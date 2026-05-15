import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationInterestSignalFromSource,
  isRecommendationInterestSignal,
  normalizeRecommendationInterestSignal,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation,
  type RecommendationInterestEvidence,
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

const evidence: RecommendationInterestEvidence = {
  sourceItemKind: "post",
  protocol: "activitypub",
  sourceVisibility: "public",
  accessBasis: "public_web",
  trustBoundary: "remote_provider",
  observedAt: "2026-05-15T00:00:00.000Z"
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

test("interest signals normalize privacy-safe allowed-consent metadata", () => {
  const signal = normalizeRecommendationInterestSignal({
    target: { kind: "hashtag", key: "books" },
    action: "follow",
    polarity: "positive",
    strength: 0.8,
    confidence: 0.9,
    dataUse: "ranking",
    privacyBoundary: "local_only",
    evidence,
    consent: consentEvent,
    expiresAt: "2026-06-15T00:00:00.000Z"
  });

  assert.equal(Object.isFrozen(signal), true);
  assert.equal(Object.isFrozen(signal.target), true);
  assert.equal(Object.isFrozen(signal.evidence), true);
  assert.equal(Object.isFrozen(signal.consent), true);
  assert.equal(isRecommendationInterestSignal(signal), true);
  assert.deepEqual(signal.target, { kind: "hashtag", key: "books" });
  assert.equal(signal.privacyBoundary, "local_only");
});

test("interest signals reject denied consent and mismatched consent metadata", () => {
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "hashtag", key: "books" },
        action: "follow",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: { ...consentEvent, decision: "deny" }
      }),
    TypeError
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "hashtag", key: "books" },
        action: "follow",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "embeddings",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
});

test("interest signals reject unsafe target keys and invalid scores", () => {
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "domain", key: "https://example.com/private/post" },
        action: "click",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "creator", key: "@alice@example.com" },
        action: "follow",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "hashtag", key: "books" },
        action: "follow",
        strength: 1.1,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
});

test("interest signals reject path-bearing and malformed domain target keys", () => {
  assert.equal(
    normalizeRecommendationInterestSignal({
      target: { kind: "domain", key: "example.com" },
      action: "click",
      strength: 0.6,
      confidence: 0.7,
      dataUse: "ranking",
      evidence,
      consent: consentEvent
    }).target.key,
    "example.com"
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "domain", key: "example.com/private/post" },
        action: "click",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "domain", key: "localhost" },
        action: "click",
        strength: 0.8,
        confidence: 0.9,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
});

test("interest signals reject control characters in target keys", () => {
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "keyword", key: "books\u0000fiction" },
        action: "search",
        strength: 0.5,
        confidence: 0.5,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
  assert.throws(
    () =>
      normalizeRecommendationInterestSignal({
        target: { kind: "keyword", key: "books\ffiction" },
        action: "search",
        strength: 0.5,
        confidence: 0.5,
        dataUse: "ranking",
        evidence,
        consent: consentEvent
      }),
    TypeError
  );
});

test("interest signals explicitly pick cloned evidence and consent properties", () => {
  const signal = normalizeRecommendationInterestSignal({
    target: { kind: "keyword", key: "books" },
    action: "search",
    strength: 0.5,
    confidence: 0.5,
    dataUse: "ranking",
    evidence: { ...evidence, unsafeSourceId: "opaque-source-id" } as RecommendationInterestEvidence,
    consent: { ...consentEvent, subjectId: "did:web:alice.example" } as PrivacySafeRecommendationConsentEvent
  });
  const serialized = JSON.stringify(signal);

  assert.equal(serialized.includes("unsafeSourceId"), false);
  assert.equal(serialized.includes("opaque-source-id"), false);
  assert.equal(serialized.includes("subjectId"), false);
  assert.equal(serialized.includes("did:web:alice.example"), false);
});

test("interest signal normalization rejects non-object input", () => {
  assert.throws(() => normalizeRecommendationInterestSignal(null as never), TypeError);
  assert.throws(() => normalizeRecommendationInterestSignal(undefined as never), TypeError);
});

test("interest signals derive evidence from source without copying opaque provenance", () => {
  const signal = createRecommendationInterestSignalFromSource({
    source: sourceItem,
    target: { kind: "canonical_interest", key: "books.fiction" },
    action: "view",
    strength: 0.4,
    confidence: 0.7,
    dataUse: "ranking",
    consentEvaluation
  });
  const serialized = JSON.stringify(signal);

  assert.equal(signal.evidence.sourceItemKind, "post");
  assert.equal(signal.evidence.protocol, "activitypub");
  assert.equal(signal.evidence.trustBoundary, "remote_provider");
  assert.equal(serialized.includes("opaque-source-id"), false);
  assert.equal(serialized.includes("activitypub-test"), false);
  assert.equal(serialized.includes("test-fediverse"), false);
});

test("interest signal source factory rejects mismatched source and consent metadata", () => {
  assert.throws(
    () =>
      createRecommendationInterestSignalFromSource({
        source: {
          ...sourceItem,
          context: {
            ...sourceItem.context,
            sourceVisibility: "followers_only"
          }
        },
        target: { kind: "canonical_interest", key: "books.fiction" },
        action: "view",
        strength: 0.4,
        confidence: 0.7,
        dataUse: "ranking",
        consentEvaluation
      }),
    TypeError
  );
});

test("interest signals default to neutral local-only signals", () => {
  const signal = normalizeRecommendationInterestSignal({
    target: { kind: "keyword", key: "science-fiction" },
    action: "search",
    strength: 0.5,
    confidence: 0.5,
    dataUse: "ranking",
    evidence,
    consent: consentEvent
  });

  assert.equal(signal.polarity, "neutral");
  assert.equal(signal.privacyBoundary, "local_only");
});
