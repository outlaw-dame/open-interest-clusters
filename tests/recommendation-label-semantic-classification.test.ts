import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecommendationConsent } from "../src/recommendation/consent.js";
import {
  classifyRecommendationLabelSemantics,
  classifyRecommendationLabelSemanticsBatch,
  normalizeRecommendationLabelSemanticDefinition
} from "../src/recommendation/label-semantic-classification.js";
import { evaluateRecommendationLabelerSignalPolicy } from "../src/recommendation/labeler-signal-policy.js";

const SUBJECT_ID = "did:plc:user123";
const LABELER_DID = "did:plc:labeler123";
const OTHER_LABELER_DID = "did:plc:otherlabeler123";
const NOW = "2026-08-01T20:00:00Z";

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

function acceptedEvaluation(value = "Sports.NBA", collection = "app.bsky.feed.post") {
  return evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: {
      src: LABELER_DID,
      uri: `at://did:plc:alice/${collection}/abc123`,
      cid: "bafyreibasecid123",
      val: value,
      cts: "2026-07-31T00:00:00Z",
      provenance: "subscribe_labels"
    },
    subscription: {
      subjectId: SUBJECT_ID,
      labelerDid: LABELER_DID,
      source: "atproto",
      subscribedAt: "2026-07-01T00:00:00Z"
    },
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });
}

test("classifyRecommendationLabelSemantics leaves labels unclassified without an explicit definition", () => {
  const classification = classifyRecommendationLabelSemantics({
    evaluation: acceptedEvaluation()
  });

  assert.deepEqual(classification, {
    decision: "unclassified",
    semanticKind: "unknown",
    reasonCode: "label_semantics.unclassified.no_definition",
    confidence: 0
  });
  assert.equal(Object.isFrozen(classification), true);
});

test("classifyRecommendationLabelSemantics classifies an exact labeler-scoped definition", () => {
  const classification = classifyRecommendationLabelSemantics({
    evaluation: acceptedEvaluation("spam"),
    definitions: [
      {
        definitionId: "labeler123-spam",
        source: "labeler_declared",
        labelerDid: LABELER_DID,
        value: "spam",
        semanticKind: "moderation"
      }
    ]
  });

  assert.deepEqual(classification, {
    decision: "classified",
    semanticKind: "moderation",
    reasonCode: "label_semantics.classified.explicit_definition",
    confidence: 1,
    definitionId: "labeler123-spam",
    definitionSource: "labeler_declared"
  });
});

test("classifyRecommendationLabelSemantics preserves case-sensitive label meaning", () => {
  const classification = classifyRecommendationLabelSemantics({
    evaluation: acceptedEvaluation("Spam"),
    definitions: [
      {
        definitionId: "lowercase-spam",
        source: "host_app",
        labelerDid: LABELER_DID,
        value: "spam",
        semanticKind: "moderation"
      }
    ]
  });

  assert.equal(classification.decision, "unclassified");
});

test("classifyRecommendationLabelSemantics does not apply another labeler's definition", () => {
  const classification = classifyRecommendationLabelSemantics({
    evaluation: acceptedEvaluation("sports.nba"),
    definitions: [
      {
        definitionId: "other-sports",
        source: "imported",
        labelerDid: OTHER_LABELER_DID,
        value: "sports.nba",
        semanticKind: "topic_interest"
      }
    ]
  });

  assert.equal(classification.decision, "unclassified");
  assert.equal(classification.semanticKind, "unknown");
});

test("classifyRecommendationLabelSemantics prefers the most target-specific definition", () => {
  const classification = classifyRecommendationLabelSemantics({
    evaluation: acceptedEvaluation("news"),
    definitions: [
      {
        definitionId: "news-general",
        source: "host_app",
        labelerDid: LABELER_DID,
        value: "news",
        semanticKind: "topic_interest"
      },
      {
        definitionId: "news-post-format",
        source: "labeler_declared",
        labelerDid: LABELER_DID,
        value: "news",
        semanticKind: "content_format",
        targetKinds: ["record"],
        recordKinds: ["post"]
      }
    ]
  });

  assert.equal(classification.semanticKind, "content_format");
  assert.equal(classification.definitionId, "news-post-format");
  assert.equal(classification.definitionSource, "labeler_declared");
});

test("classifyRecommendationLabelSemantics rejects equally specific conflicting definitions", () => {
  assert.throws(
    () =>
      classifyRecommendationLabelSemantics({
        evaluation: acceptedEvaluation("community"),
        definitions: [
          {
            definitionId: "community-identity",
            source: "host_app",
            labelerDid: LABELER_DID,
            value: "community",
            semanticKind: "identity",
            targetKinds: ["record"]
          },
          {
            definitionId: "community-membership",
            source: "imported",
            labelerDid: LABELER_DID,
            value: "community",
            semanticKind: "community",
            targetKinds: ["record"]
          }
        ]
      }),
    /Conflicting recommendation label semantic definitions/u
  );
});

test("classifyRecommendationLabelSemantics returns not_applicable for policy-ignored labels", () => {
  const ignored = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: {
      src: LABELER_DID,
      uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
      val: "sports.nba",
      cts: "2026-07-31T00:00:00Z",
      provenance: "query_labels"
    },
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  assert.deepEqual(classifyRecommendationLabelSemantics({ evaluation: ignored }), {
    decision: "not_applicable",
    semanticKind: "unknown",
    reasonCode: "label_semantics.not_applicable.policy_ignored",
    confidence: 0
  });
});

test("classifyRecommendationLabelSemanticsBatch reports deterministic decision counts", () => {
  const ignored = evaluateRecommendationLabelerSignalPolicy({
    subjectId: SUBJECT_ID,
    label: {
      src: LABELER_DID,
      uri: "at://did:plc:alice/app.bsky.feed.post/abc123",
      val: "spam",
      cts: "2026-07-31T00:00:00Z",
      provenance: "query_labels"
    },
    consentEvaluation: ALLOW_CONSENT,
    now: NOW
  });

  const result = classifyRecommendationLabelSemanticsBatch({
    evaluations: [acceptedEvaluation("spam"), acceptedEvaluation("unknown-label"), ignored],
    definitions: [
      {
        definitionId: "spam-moderation",
        source: "labeler_declared",
        labelerDid: LABELER_DID,
        value: "spam",
        semanticKind: "moderation"
      }
    ]
  });

  assert.equal(result.classifiedCount, 1);
  assert.equal(result.unclassifiedCount, 1);
  assert.equal(result.notApplicableCount, 1);
  assert.equal(result.classifications.length, 3);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.classifications), true);
});

test("normalizeRecommendationLabelSemanticDefinition rejects unknown as an explicit semantic kind", () => {
  assert.throws(
    () =>
      normalizeRecommendationLabelSemanticDefinition({
        definitionId: "invalid-unknown",
        source: "host_app",
        labelerDid: LABELER_DID,
        value: "unknown-label",
        semanticKind: "unknown" as never
      }),
    /Invalid recommendation label semantic kind/u
  );
});

test("normalizeRecommendationLabelSemanticDefinition rejects invalid provenance", () => {
  assert.throws(
    () =>
      normalizeRecommendationLabelSemanticDefinition({
        definitionId: "invalid-source",
        source: "guessed" as never,
        labelerDid: LABELER_DID,
        value: "sports",
        semanticKind: "topic_interest"
      }),
    /Invalid recommendation label semantic definition source/u
  );
});

test("normalizeRecommendationLabelSemanticDefinition rejects duplicate target constraints", () => {
  assert.throws(
    () =>
      normalizeRecommendationLabelSemanticDefinition({
        definitionId: "duplicate-targets",
        source: "host_app",
        labelerDid: LABELER_DID,
        value: "sports",
        semanticKind: "topic_interest",
        targetKinds: ["record", "record"]
      }),
    /Invalid recommendation label semantic target kinds/u
  );
});
