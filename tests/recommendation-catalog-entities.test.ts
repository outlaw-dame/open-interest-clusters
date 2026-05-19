import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID,
  RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1,
  createEntityEnrichedRecommendationCatalog,
  createRecommendationCatalogEntityKey,
  findRecommendationCanonicalTagsForEntity,
  findRecommendationCatalogTopicsForEntity,
  hasRecommendationCatalogEntity,
  normalizeRecommendationCatalog,
  resolveRecommendationCanonicalTagForHashtag,
  resolveRecommendationCatalogEntity
} from "../src/index.js";

interface ExpectedEntityMapping {
  source: "wikidata" | "dbpedia";
  id: string;
  topicIds: string[];
  canonicalTagIds: string[];
}

function assertEntityMapsToExpectedTargets(mapping: ExpectedEntityMapping): void {
  const resolution = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, {
    source: mapping.source,
    id: mapping.id
  });

  assert.notEqual(resolution, null, `${mapping.source}:${mapping.id} should resolve`);
  assert.deepEqual(resolution?.topicIds, mapping.topicIds, `${mapping.source}:${mapping.id} topic ids`);
  assert.deepEqual(resolution?.canonicalTagIds, mapping.canonicalTagIds, `${mapping.source}:${mapping.id} canonical tag ids`);
}

test("entity-enriched global catalog preserves catalog shape and adds stable entity refs", () => {
  const baseCatalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const entityCatalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1);

  assert.equal(entityCatalog.catalogId, RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID);
  assert.equal(entityCatalog.topics.length, baseCatalog.topics.length);
  assert.equal(entityCatalog.canonicalTags.length, baseCatalog.canonicalTags.length);
  assert.equal(hasRecommendationCatalogEntity(entityCatalog, { source: "wikidata", id: "Q155223" }), true);
  assert.equal(hasRecommendationCatalogEntity(baseCatalog, { source: "wikidata", id: "Q155223" }), false);
});

test("entity enrichment helper preserves caller catalog ids", () => {
  const tenantCatalog = normalizeRecommendationCatalog({
    ...RECOMMENDATION_GLOBAL_CATALOG_V1,
    catalogId: "tenant.catalog.v1"
  });
  const enriched = createEntityEnrichedRecommendationCatalog(tenantCatalog);

  assert.equal(enriched.catalogId, "tenant.catalog.v1");
  assert.equal(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1.catalogId, RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID);
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

test("expanded entity anchors resolve to intentional catalog targets only", () => {
  const mappings: ExpectedEntityMapping[] = [
    { source: "wikidata", id: "Q7889", topicIds: ["gaming"], canonicalTagIds: ["gaming"] },
    { source: "dbpedia", id: "Video_game", topicIds: ["gaming"], canonicalTagIds: ["gaming"] },
    { source: "wikidata", id: "Q8274", topicIds: ["anime.core"], canonicalTagIds: ["anime.core"] },
    { source: "dbpedia", id: "Manga", topicIds: ["anime.core"], canonicalTagIds: ["anime.core"] },
    { source: "wikidata", id: "Q638", topicIds: ["music"], canonicalTagIds: ["music"] },
    { source: "wikidata", id: "Q11424", topicIds: ["movies-tv.film"], canonicalTagIds: ["movies-tv.film"] },
    { source: "dbpedia", id: "Film", topicIds: ["movies-tv.film"], canonicalTagIds: ["movies-tv.film"] },
    { source: "wikidata", id: "Q907311", topicIds: ["movies-tv.streaming"], canonicalTagIds: ["movies-tv.streaming"] },
    { source: "wikidata", id: "Q2736", topicIds: ["sports.soccer"], canonicalTagIds: ["sports.soccer"] },
    { source: "dbpedia", id: "Association_football", topicIds: ["sports.soccer"], canonicalTagIds: ["sports.soccer"] },
    { source: "wikidata", id: "Q5389", topicIds: ["sports.general"], canonicalTagIds: ["sports.general"] },
    { source: "wikidata", id: "Q309252", topicIds: ["fitness", "fitness.workouts"], canonicalTagIds: ["fitness", "fitness.workouts"] },
    { source: "dbpedia", id: "Physical_fitness", topicIds: ["fitness", "fitness.workouts"], canonicalTagIds: ["fitness", "fitness.workouts"] },
    { source: "wikidata", id: "Q9350", topicIds: ["fitness.yoga-pilates"], canonicalTagIds: ["fitness.yoga-pilates"] },
    { source: "wikidata", id: "Q317309", topicIds: ["mental-health-wellness", "mental-health-wellness.core"], canonicalTagIds: ["mental-health-wellness", "mental-health-wellness.core"] },
    { source: "dbpedia", id: "Mental_health", topicIds: ["mental-health-wellness", "mental-health-wellness.core"], canonicalTagIds: ["mental-health-wellness", "mental-health-wellness.core"] },
    { source: "wikidata", id: "Q11016", topicIds: ["technology", "technology.consumer"], canonicalTagIds: ["technology", "technology.consumer"] },
    { source: "wikidata", id: "Q7397", topicIds: ["technology.software"], canonicalTagIds: ["technology.software"] },
    { source: "wikidata", id: "Q20514253", topicIds: ["business-finance.crypto"], canonicalTagIds: ["business-finance.crypto"] },
    { source: "wikidata", id: "Q336", topicIds: ["science", "science.core"], canonicalTagIds: ["science", "science.core"] },
    { source: "wikidata", id: "Q11633", topicIds: ["photography", "photography.gear"], canonicalTagIds: ["photography", "photography.gear"] },
    { source: "wikidata", id: "Q40831", topicIds: ["comedy", "comedy.core"], canonicalTagIds: ["comedy", "comedy.core"] },
    { source: "wikidata", id: "Q1420", topicIds: ["automobiles-evs.culture"], canonicalTagIds: ["automobiles-evs.culture"] },
    { source: "wikidata", id: "Q193692", topicIds: ["automobiles-evs.ev"], canonicalTagIds: ["automobiles-evs.ev"] },
    { source: "dbpedia", id: "Electric_car", topicIds: ["automobiles-evs.ev"], canonicalTagIds: ["automobiles-evs.ev"] },
    { source: "wikidata", id: "Q729", topicIds: ["animals", "animals.wildlife"], canonicalTagIds: ["animals", "animals.wildlife"] },
    { source: "wikidata", id: "Q571", topicIds: ["books-literature", "books-literature.core"], canonicalTagIds: ["books-literature", "books-literature.core"] },
    { source: "wikidata", id: "Q2095", topicIds: ["food-cooking", "food-cooking.core"], canonicalTagIds: ["food-cooking", "food-cooking.core"] }
  ];

  for (const mapping of mappings) {
    assertEntityMapsToExpectedTargets(mapping);
  }
});

test("sensitive entity anchors inherit sensitive catalog boundaries", () => {
  const resolution = resolveRecommendationCatalogEntity(RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1, {
    source: "wikidata",
    id: "Q317309"
  });

  assert.notEqual(resolution, null);
  assert.deepEqual(resolution?.topicIds, ["mental-health-wellness", "mental-health-wellness.core"]);
  assert.equal(resolution?.topics.every((topic) => topic.sensitive === true), true);
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
