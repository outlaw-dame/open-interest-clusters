import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecommendationLabelEffectPolicy,
  evaluateRecommendationLabelEffectPolicyBatch,
  normalizeRecommendationLabelEffectPolicyDefinition
} from "../src/recommendation/label-signal-effect-policy.js";
import type { RecommendationLabelSemanticClassification } from "../src/recommendation/label-semantic-classification.js";

function classified(semanticKind: Exclude<RecommendationLabelSemanticClassification["semanticKind"], "unknown">): RecommendationLabelSemanticClassification {
  return Object.freeze({
    decision: "classified",
    semanticKind,
    reasonCode: "label_semantics.classified.explicit_definition",
    confidence: 1,
    definitionId: `${semanticKind}-definition`,
    definitionSource: "host_app"
  });
}

const UNCLASSIFIED: RecommendationLabelSemanticClassification = Object.freeze({
  decision: "unclassified",
  semanticKind: "unknown",
  reasonCode: "label_semantics.unclassified.no_definition",
  confidence: 0
});

const NOT_APPLICABLE: RecommendationLabelSemanticClassification = Object.freeze({
  decision: "not_applicable",
  semanticKind: "unknown",
  reasonCode: "label_semantics.not_applicable.policy_ignored",
  confidence: 0
});

test("evaluateRecommendationLabelEffectPolicy maps topic interests to positive interest intent by default", () => {
  const evaluation = evaluateRecommendationLabelEffectPolicy({ classification: classified("topic_interest") });

  assert.deepEqual(evaluation, {
    decision: "apply",
    semanticKind: "topic_interest",
    effectKind: "positive_interest",
    reasonCode: "label_effect.apply.engine_default",
    policySource: "engine_default"
  });
  assert.equal(Object.isFrozen(evaluation), true);
});

test("evaluateRecommendationLabelEffectPolicy maps moderation, safety, and eligibility to constraints", () => {
  assert.equal(
    evaluateRecommendationLabelEffectPolicy({ classification: classified("moderation") }).effectKind,
    "moderation_constraint"
  );
  assert.equal(
    evaluateRecommendationLabelEffectPolicy({ classification: classified("safety") }).effectKind,
    "safety_constraint"
  );
  assert.equal(
    evaluateRecommendationLabelEffectPolicy({ classification: classified("eligibility") }).effectKind,
    "eligibility_constraint"
  );
});

test("evaluateRecommendationLabelEffectPolicy keeps identity, community, content format, and game evidence-only by default", () => {
  for (const semanticKind of ["identity", "community", "content_format", "game"] as const) {
    const evaluation = evaluateRecommendationLabelEffectPolicy({ classification: classified(semanticKind) });
    assert.equal(evaluation.decision, "evidence_only");
    assert.equal(evaluation.effectKind, "evidence_only");
    assert.equal(evaluation.reasonCode, "label_effect.evidence_only.engine_default");
  }
});

test("evaluateRecommendationLabelEffectPolicy allows explicit bounded opt-in effects", () => {
  const evaluation = evaluateRecommendationLabelEffectPolicy({
    classification: classified("community"),
    definitions: [
      {
        policyId: "community-affinity",
        source: "host_app",
        semanticKind: "community",
        effectKind: "contextual_affinity"
      }
    ]
  });

  assert.deepEqual(evaluation, {
    decision: "apply",
    semanticKind: "community",
    effectKind: "contextual_affinity",
    reasonCode: "label_effect.apply.explicit_policy",
    policyId: "community-affinity",
    policySource: "host_app"
  });
});

test("evaluateRecommendationLabelEffectPolicy allows explicit evidence-only suppression", () => {
  const evaluation = evaluateRecommendationLabelEffectPolicy({
    classification: classified("topic_interest"),
    definitions: [
      {
        policyId: "disable-topic-effect",
        source: "imported",
        semanticKind: "topic_interest",
        effectKind: "evidence_only"
      }
    ]
  });

  assert.equal(evaluation.decision, "evidence_only");
  assert.equal(evaluation.effectKind, "evidence_only");
  assert.equal(evaluation.reasonCode, "label_effect.evidence_only.explicit_policy");
  assert.equal(evaluation.policyId, "disable-topic-effect");
});

test("evaluateRecommendationLabelEffectPolicy rejects semantically incompatible effects", () => {
  assert.throws(
    () =>
      evaluateRecommendationLabelEffectPolicy({
        classification: classified("moderation"),
        definitions: [
          {
            policyId: "unsafe-moderation-interest",
            source: "host_app",
            semanticKind: "moderation",
            effectKind: "positive_interest"
          }
        ]
      }),
    /incompatible with semantic kind/u
  );
});

test("evaluateRecommendationLabelEffectPolicy returns no effect for unclassified and ignored labels", () => {
  assert.deepEqual(evaluateRecommendationLabelEffectPolicy({ classification: UNCLASSIFIED }), {
    decision: "not_applicable",
    semanticKind: "unknown",
    reasonCode: "label_effect.not_applicable.unclassified"
  });
  assert.deepEqual(evaluateRecommendationLabelEffectPolicy({ classification: NOT_APPLICABLE }), {
    decision: "not_applicable",
    semanticKind: "unknown",
    reasonCode: "label_effect.not_applicable.policy_ignored"
  });
});

test("evaluateRecommendationLabelEffectPolicyBatch reports deterministic counts", () => {
  const result = evaluateRecommendationLabelEffectPolicyBatch({
    classifications: [
      classified("topic_interest"),
      classified("identity"),
      classified("moderation"),
      UNCLASSIFIED,
      NOT_APPLICABLE
    ]
  });

  assert.equal(result.appliedCount, 2);
  assert.equal(result.evidenceOnlyCount, 1);
  assert.equal(result.notApplicableCount, 2);
  assert.equal(result.evaluations.length, 5);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evaluations), true);
});

test("normalizeRecommendationLabelEffectPolicyDefinition rejects duplicate semantic policies", () => {
  assert.throws(
    () =>
      evaluateRecommendationLabelEffectPolicyBatch({
        classifications: [classified("topic_interest")],
        definitions: [
          {
            policyId: "topic-positive",
            source: "host_app",
            semanticKind: "topic_interest",
            effectKind: "positive_interest"
          },
          {
            policyId: "topic-negative",
            source: "imported",
            semanticKind: "topic_interest",
            effectKind: "negative_interest"
          }
        ]
      }),
    /Duplicate recommendation label effect semantic policy/u
  );
});

test("normalizeRecommendationLabelEffectPolicyDefinition rejects engine_default as an external policy source", () => {
  assert.throws(
    () =>
      normalizeRecommendationLabelEffectPolicyDefinition({
        policyId: "invalid-source",
        source: "engine_default" as never,
        semanticKind: "topic_interest",
        effectKind: "positive_interest"
      }),
    /Invalid recommendation label effect policy source/u
  );
});

test("evaluateRecommendationLabelEffectPolicy rejects inconsistent classification states", () => {
  assert.throws(
    () =>
      evaluateRecommendationLabelEffectPolicy({
        classification: {
          decision: "classified",
          semanticKind: "unknown",
          reasonCode: "label_semantics.unclassified.no_definition",
          confidence: 0
        } as RecommendationLabelSemanticClassification
      }),
    /Invalid recommendation label effect classification state/u
  );
});

test("evaluateRecommendationLabelEffectPolicy rejects forged classified provenance", () => {
  for (const classification of [
    {
      decision: "classified",
      semanticKind: "topic_interest",
      reasonCode: "label_semantics.unclassified.no_definition",
      confidence: 0,
      definitionId: "forged-definition",
      definitionSource: "host_app"
    },
    {
      decision: "classified",
      semanticKind: "topic_interest",
      reasonCode: "label_semantics.classified.explicit_definition",
      confidence: 1,
      definitionSource: "host_app"
    },
    {
      decision: "classified",
      semanticKind: "topic_interest",
      reasonCode: "label_semantics.classified.explicit_definition",
      confidence: 1,
      definitionId: "forged-definition",
      definitionSource: "guessed"
    }
  ]) {
    assert.throws(
      () =>
        evaluateRecommendationLabelEffectPolicy({
          classification: classification as RecommendationLabelSemanticClassification
        }),
      /Invalid recommendation label effect classification state/u
    );
  }
});

test("evaluateRecommendationLabelEffectPolicy rejects extra fields in non-classified states", () => {
  assert.throws(
    () =>
      evaluateRecommendationLabelEffectPolicy({
        classification: {
          ...UNCLASSIFIED,
          definitionId: "unexpected-definition"
        } as RecommendationLabelSemanticClassification
      }),
    /Invalid recommendation label effect classification state/u
  );
});