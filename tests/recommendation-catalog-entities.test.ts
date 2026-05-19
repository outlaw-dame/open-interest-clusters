import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID,
  RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1,
  createRecommendationCatalogEntityKey,
  findRecommendationCanonicalTagsForEntity,
  findRecommendationCatalogTopicsForEntity,
  hasRecommendationCatalogEntity,
  normalizeRecommendationCatalog,
  resolveRecommendationCanonicalTagForHashtag,
  resolveRecommendationCatalogEntity
} from "../src/index.js";

test("entity-enriched global catalog preserves catalog shape and adds stable entity refs", () => {
  const baseCatalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const entityCatalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);

  assert.equal(entityCatalog.catalogId, RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID);
  assert.equal(entityCatalog.topics.length, baseCatalog.topics.length);
  assert.equal(entityCatalog.canonicalTags.length, baseCatalog.canonicalTags.length);
  assert.equal(hasRecommendationCatalogEntity(entityCatalog, { source: "wikidata", id: "Q155223" }), true);
  assert.equal(hasRecommendationCatalogEntity(baseCatalog, { source: "wikidata", id: "Q155223" }), false);
});

test("entity resolver maps stable entities to topics and canonical tags", () => {
  const nba = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Q155223" });
  const apple = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "dbpedia", id: "Apple_Inc." });
  const ps5 = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Q63184502" });

  assert.deepEqual(nba?.topicIds, ["nba", "nba.core"]);
  assert.deepEqual(nba?.canonicalTagIds, ["nba", "nba.core"]);
  assert.deepEqual(apple?.topicIds, ["apple", "apple.products"]);
  assert.deepEqual(apple?.canonicalTagIds, ["apple", "apple.products"]);
  assert.deepEqual(ps5?.topicIds, ["gaming.playstation"]);
  assert.deepEqual(ps5?.canonicalTagIds, ["gaming.playstation"]);
});

test("entity resolver exposes topic and canonical tag convenience helpers", () => {
  const topics = findRecommendationCatalogTopicsForEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Q11660" });
  const tags = findRecommendationCanonicalTagsForEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Q11660" });

  assert.deepEqual(topics.map((topic) => topic.id), ["ai", "ai.generative"]);
  assert.deepEqual(tags.map((tag) => tag.id), ["ai", "ai.generative"]);
  assert.equal(createRecommendationCatalogEntityKey({ source: "wikidata", id: "Q11660" }), "wikidata:Q11660");
});

test("hashtag resolution prefers specific subtopic tags over duplicate primary tags", () => {
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#AI")?.id, "ai.generative");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#NBA")?.id, "nba.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#KPop")?.id, "k-pop.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#Science")?.id, "science.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#Photography")?.id, "photography.gear");
});

test("entity-enriched catalog preserves singular and plural streamer coverage", () => {
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#Streamer")?.id, "content-creators.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#Streamers")?.id, "content-creators.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, "#GameStreaming")?.id, "esports-game-streaming.streaming");
});

test("entity resolver validates lookup identifiers safely", () => {
  assert.throws(
    () => resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "wikidata", id: "Artificial_intelligence" }),
    TypeError
  );
  assert.throws(
    () => resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, { source: "dbpedia", id: "https://dbpedia.org/resource/Apple_Inc." }),
    TypeError
  );
});