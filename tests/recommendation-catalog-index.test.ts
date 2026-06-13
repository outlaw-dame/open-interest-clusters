import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1,
  createRecommendationCatalogIndex,
  findRecommendationCanonicalTagInIndex,
  findRecommendationCatalogTopicInIndex,
  normalizeRecommendationCatalog,
  resolveRecommendationCanonicalTagFromIndex,
  resolveRecommendationCatalogEntity,
  resolveRecommendationCatalogEntityFromIndex,
  type RecommendationCatalog
} from "../src/index.js";

test("catalog index builds stable topic, tag, token, and entity lookup maps", () => {
  const catalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);
  const index = createRecommendationCatalogIndex(catalog);

  assert.equal(index.catalog, catalog);
  assert.equal(index.topicsById.size, catalog.topics.length);
  assert.equal(index.primaryTopicsById.size + index.subtopicsById.size, catalog.topics.length);
  assert.equal(index.canonicalTagsById.size, catalog.canonicalTags.length);
  assert.ok(index.entityRefsByKey.has("wikidata:Q7889"));
  assert.ok(index.entityRefsByKey.has("dbpedia:Video_game"));
});

test("catalog index resolves canonical tag tokens with existing specificity semantics", () => {
  const index = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);

  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#PS5")?.id, "gaming.playstation");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "PlayStationFive")?.id, "gaming.playstation");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#KPopFedi")?.id, "k-pop.core");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#AI")?.id, "ai.generative");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#NBA")?.id, "nba.core");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#Streamer")?.id, "content-creators.core");
  assert.equal(resolveRecommendationCanonicalTagFromIndex(index, "#Streamers")?.id, "content-creators.core");
});

test("catalog index records duplicate token collisions without losing deterministic resolution", () => {
  const index = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);
  const aiCollision = index.tagTokenCollisions.find((collision) => collision.normalizedToken === "ai");
  const nbaCollision = index.tagTokenCollisions.find((collision) => collision.normalizedToken === "nba");

  assert.ok(aiCollision);
  assert.deepEqual(aiCollision.canonicalTagIds, ["ai", "ai.generative"]);
  assert.equal(aiCollision.resolvedCanonicalTagId, "ai.generative");
  assert.equal(aiCollision.ambiguous, false);
  assert.ok(nbaCollision);
  assert.deepEqual(nbaCollision.canonicalTagIds, ["nba", "nba.core"]);
  assert.equal(nbaCollision.resolvedCanonicalTagId, "nba.core");
  assert.equal(nbaCollision.ambiguous, false);
});

test("catalog index resolves entity refs consistently with scan-based entity resolution", () => {
  const index = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);
  const indexedVideoGame = resolveRecommendationCatalogEntityFromIndex(index, { source: "wikidata", id: "Q7889" });
  const scannedVideoGame = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Q7889" });
  const indexedMentalHealth = resolveRecommendationCatalogEntityFromIndex(index, { source: "dbpedia", id: "Mental_health" });

  assert.ok(indexedVideoGame);
  assert.ok(scannedVideoGame);
  assert.deepEqual(indexedVideoGame.topicIds, scannedVideoGame.topicIds);
  assert.deepEqual(indexedVideoGame.canonicalTagIds, scannedVideoGame.canonicalTagIds);
  assert.deepEqual(indexedVideoGame.topicIds, ["gaming"]);
  assert.deepEqual(indexedVideoGame.canonicalTagIds, ["gaming"]);
  assert.ok(indexedMentalHealth);
  assert.deepEqual(indexedMentalHealth.topicIds, ["mental-health-wellness", "mental-health-wellness.core"]);
  assert.ok(indexedMentalHealth.topics.every((topic) => topic.sensitive === true));
});

test("catalog index supports direct topic and canonical tag lookup with safe id validation", () => {
  const index = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);

  assert.equal(findRecommendationCatalogTopicInIndex(index, "gaming.playstation")?.label, "PlayStation");
  assert.equal(findRecommendationCanonicalTagInIndex(index, "gaming.playstation")?.displayLabel, "PlayStation");
  assert.equal(findRecommendationCatalogTopicInIndex(index, "not-present"), null);
  assert.throws(() => findRecommendationCatalogTopicInIndex(index, "Bad Topic"), TypeError);
  assert.throws(() => resolveRecommendationCanonicalTagFromIndex(index, `bad${String.fromCharCode(0x80)}token`), TypeError);
  assert.throws(() => resolveRecommendationCanonicalTagFromIndex(index, "https://example.invalid/tag"), TypeError);
});

test("catalog index can reject ambiguous same-specificity token collisions", () => {
  const ambiguousCatalog: RecommendationCatalog = normalizeRecommendationCatalog({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: "ambiguous.catalog.v1",
    locale: "en-US",
    topics: [
      {
        id: "alpha",
        kind: "primary",
        label: "Alpha",
        canonicalTagIds: ["alpha.one", "alpha.two"],
        hashtags: ["#Alpha"]
      }
    ],
    canonicalTags: [
      {
        id: "alpha.one",
        displayLabel: "Alpha One",
        variants: ["Shared"],
        hashtags: ["#Shared"],
        parentTopicIds: ["alpha"]
      },
      {
        id: "alpha.two",
        displayLabel: "Alpha Two",
        variants: ["Shared"],
        hashtags: ["#Shared"],
        parentTopicIds: ["alpha"]
      }
    ]
  });

  const permissiveIndex = createRecommendationCatalogIndex(ambiguousCatalog);
  const collision = permissiveIndex.tagTokenCollisions.find((item) => item.normalizedToken === "shared");

  assert.ok(collision);
  assert.deepEqual(collision.canonicalTagIds, ["alpha.one", "alpha.two"]);
  assert.equal(collision.ambiguous, true);
  assert.equal(resolveRecommendationCanonicalTagFromIndex(permissiveIndex, "#Shared")?.id, "alpha.one");
  assert.throws(() => createRecommendationCatalogIndex(ambiguousCatalog, { rejectAmbiguousTagMatches: true }), TypeError);
});
