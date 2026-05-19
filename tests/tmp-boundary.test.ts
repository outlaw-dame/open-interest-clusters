import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  createRecommendationCatalogIndex,
  createRecommendationOnboardingProfileSeed,
  createRecommendationOnboardingSelection,
  normalizeRecommendationCatalog,
  type RecommendationConsentPolicy
} from "../src/index.js";

const subjectId = "u";
const selectedAt = "2026-05-19T00:00:00.000Z";
const uses = Object.freeze(["local_personalization"] as const);

function makePolicy(): RecommendationConsentPolicy {
  return Object.freeze({ subjectId, allowedDataUses: uses, privateDataUses: uses });
}

function makeCatalog() {
  return normalizeRecommendationCatalog({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: "guarded.catalog.v1",
    topics: [
      { id: "safe", kind: "primary", label: "Safe", canonicalTagIds: ["safe"] },
      { id: "guarded", kind: "primary", label: "Guarded", sensitive: true, subtopicIds: ["guarded.child"], canonicalTagIds: ["guarded"] },
      { id: "guarded.child", kind: "subtopic", label: "Guarded Child", primaryTopicId: "guarded", canonicalTagIds: ["guarded.child"] }
    ],
    canonicalTags: [
      { id: "safe", displayLabel: "Safe", variants: ["Safe"], hashtags: ["#Safe"], parentTopicIds: ["safe"] },
      { id: "guarded", displayLabel: "Guarded", variants: ["Guarded"], hashtags: ["#Guarded"], parentTopicIds: ["guarded"] },
      { id: "guarded.child", displayLabel: "Guarded Child", variants: ["GuardedChild"], hashtags: ["#GuardedChild"], parentTopicIds: ["guarded.child"] }
    ]
  });
}

test("child topic inherits guarded primary boundary", async () => {
  const catalog = makeCatalog();
  const index = createRecommendationCatalogIndex(catalog);
  const selection = createRecommendationOnboardingSelection({ catalog, selectedTopicIds: ["guarded.child"], selectedAt });

  await assert.rejects(
    createRecommendationOnboardingProfileSeed({ subjectId, catalogIndex: index, selection, policy: makePolicy() }),
    TypeError
  );
});

test("child topic works after explicit opt-in", async () => {
  const catalog = makeCatalog();
  const index = createRecommendationCatalogIndex(catalog);
  const selection = createRecommendationOnboardingSelection({ catalog, selectedTopicIds: ["guarded.child"], selectedAt });
  const result = await createRecommendationOnboardingProfileSeed({
    subjectId,
    catalogIndex: index,
    selection,
    policy: makePolicy(),
    allowSensitiveSelections: true
  });
  assert.equal(result.consent.decision, "allow");
});
