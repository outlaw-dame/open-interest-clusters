import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecommendationConsent } from "../src/recommendation/consent.js";
import {
  createRecommendationInterestSignalFromLabelerEvidence,
  deriveRecommendationInterestSignalsFromLabelerEvaluations
} from "../src/recommendation/labeler-interest-signal-derivation.js";
import { evaluateRecommendationLabelerSignalPolicy } from "../src/recommendation/labeler-signal-policy.js";

const SUBJECT_ID = "did:plc:user123";
const LABELER_DID = "did:plc:labeler123";
const NOW = "2026-01-15T00:00:00Z";

const ALLOW_CONSENT = evaluateRecommendationConsent(
  {
    subjectId: SUBJECT_ID,
    allowedDataUses: ["local_personalization"],
    privateDataUses: ["local_personalization"]
  },
  {
    subjectId: SUBJECT_ID,
    dataUse: "local_personalization",
    protocol: "atproto",
    sourceVisibility: "atproto_public_repo",
    accessBasis: "atproto_public_repo"
  }
);

const SUBSCRIPTION = Object.freeze({
  subjectId: SUBJECT_ID,
  labelerDid: LABELER_DID,
  source: "atproto" as const,
  subscribedAt: "2026-01-01T00:00:00Z"
});

const BASE_LABEL = Object.freeze({
  src: LABELER_DID,
  uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
  cid: "bafyreibasecid123",
  val: "Sports.NBA",
  cts: "2026-01-10T00:00:00Z",
  exp: "2026-02-01T00:00:00Z",
  provenance: "subscribe_labels" as const
});

function acceptedEvaluation() {
  return evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    subscription: SUBSCRIPTION,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });
}

test("createRecommendationInterestSignalFromLabelerEvidence converts accepted label evidence into a neutral interest signal", () => {
  const signal = createRecommendationInterestSignalFromLabelerEvidence({
    evaluation: acceptedEvaluation(),
    dataUse: "local_personalization"
  });

  assert.deepEqual(signal, {
    target: {
      kind: "canonical_interest",
      key: "sports-nba"
    },
    action: "label",
    polarity: "neutral",
    strength: 0.35,
    confidence: 0.65,
    dataUse: "local_personalization",
    privacyBoundary: "local_only",
    evidence: {
      sourceItemKind: "label",
      protocol: "atproto",
      sourceVisibility: "atproto_public_repo",
      accessBasis: "atproto_public_repo",
      trustBoundary: "third_party",
      observedAt: "2026-01-10T00:00:00Z"
    },
    consent: ALLOW_CONSENT.auditEvent,
    expiresAt: "2026-02-01T00:00:00Z"
  });
});

test("createRecommendationInterestSignalFromLabelerEvidence supports explicit target kind and weight overrides", () => {
  const signal = createRecommendationInterestSignalFromLabelerEvidence({
    evaluation: acceptedEvaluation(),
    dataUse: "local_personalization",
    targetKind: "moderation_label",
    strength: 0.2,
    confidence: 0.9,
    privacyBoundary: "aggregate_only",
    expiresAt: "2026-01-20T00:00:00Z"
  });

  assert.equal(signal?.target.kind, "moderation_label");
  assert.equal(signal?.strength, 0.2);
  assert.equal(signal?.confidence, 0.9);
  assert.equal(signal?.privacyBoundary, "aggregate_only");
  assert.equal(signal?.expiresAt, "2026-01-20T00:00:00Z");
});

test("createRecommendationInterestSignalFromLabelerEvidence preserves dots for domain target kind", () => {
  const signal = createRecommendationInterestSignalFromLabelerEvidence({
    evaluation: acceptedEvaluation(),
    dataUse: "local_personalization",
    targetKind: "domain"
  });

  assert.equal(signal?.target.kind, "domain");
  assert.equal(signal?.target.key, "sports.nba");
});

test("createRecommendationInterestSignalFromLabelerEvidence returns undefined for ignored policy evaluations", () => {
  const ignored = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.equal(
    createRecommendationInterestSignalFromLabelerEvidence({
      evaluation: ignored,
      dataUse: "local_personalization"
    }),
    undefined
  );
});

test("deriveRecommendationInterestSignalsFromLabelerEvaluations counts accepted and ignored evaluations", () => {
  const ignored = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: BASE_LABEL,
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  const result = deriveRecommendationInterestSignalsFromLabelerEvaluations({
    evaluations: [acceptedEvaluation(), ignored],
    dataUse: "local_personalization"
  });

  assert.equal(result.acceptedEvaluationCount, 1);
  assert.equal(result.ignoredEvaluationCount, 1);
  assert.equal(result.signals.length, 1);
});

test("deriveRecommendationInterestSignalsFromLabelerEvaluations skips malformed individual evaluations", () => {
  const result = deriveRecommendationInterestSignalsFromLabelerEvaluations({
    evaluations: [acceptedEvaluation(), { decision: "accept" } as never],
    dataUse: "local_personalization"
  });

  assert.equal(result.acceptedEvaluationCount, 1);
  assert.equal(result.ignoredEvaluationCount, 1);
  assert.equal(result.signals.length, 1);
});

test("createRecommendationInterestSignalFromLabelerEvidence rejects invalid bridge weights", () => {
  assert.throws(
    () =>
      createRecommendationInterestSignalFromLabelerEvidence({
        evaluation: acceptedEvaluation(),
        dataUse: "local_personalization",
        strength: 1.1
      }),
    /Invalid recommendation labeler interest strength/u
  );
});

test("createRecommendationInterestSignalFromLabelerEvidence rejects consent/data-use mismatches", () => {
  assert.throws(
    () =>
      createRecommendationInterestSignalFromLabelerEvidence({
        evaluation: acceptedEvaluation(),
        dataUse: "ranking"
      }),
    /Invalid recommendation labeler interest consent/u
  );
});
