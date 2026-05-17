import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  createRecommendationHashtagFollowPlan,
  createRecommendationOnboardingSelection,
  findRecommendationCanonicalTag,
  findRecommendationCatalogTopic,
  normalizeRecommendationCatalog,
  resolveRecommendationCanonicalTagForHashtag,
  type RecommendationCatalog
} from "../src/index.js";

function catalog(): RecommendationCatalog {
  return {
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: "global.v1",
    locale: "en-US",
    topics: [
      {
        id: "gaming",
        kind: "primary",
        label: "Gaming",
        popularityTier: "global_primary",
        subtopicIds: ["gaming.playstation"],
        keywords: ["Video Games", "Gaming"],
        hashtags: ["#Gaming"]
      },
      {
        id: "gaming.playstation",
        kind: "subtopic",
        label: "PlayStation",
        primaryTopicId: "gaming",
        canonicalTagIds: ["ps5"],
        keywords: ["PlayStation 5", "Sony console"],
        hashtags: ["#PlayStation5", "#PlayStationFive"],
        entityRefs: [
          {
            source: "wikidata",
            id: "Q63184502",
            label: "PlayStation 5",
            uri: "https://www.wikidata.org/wiki/Q63184502"
          },
          {
            source: "dbpedia",
            id: "PlayStation_5",
            label: "PlayStation 5",
            uri: "https://dbpedia.org/resource/PlayStation_5"
          }
        ]
      }
    ],
    canonicalTags: [
      {
        id: "ps5",
        displayLabel: "PlayStation 5",
        variants: ["PS5", "PlayStation5", "PlayStationFive"],
        hashtags: ["#PS5", "#PlayStation5", "#PlayStationFive"],
        parentTopicIds: ["gaming.playstation"],
        entityRefs: [
          {
            source: "wikidata",
            id: "Q63184502",
            label: "PlayStation 5",
            uri: "https://www.wikidata.org/wiki/Q63184502"
          }
        ]
      }
    ]
  };
}

test("recommendation catalog normalizes canonical hashtag variants and entity refs", () => {
  const normalized = normalizeRecommendationCatalog(catalog());
  const tag = findRecommendationCanonicalTag(normalized, "ps5");
  const topic = findRecommendationCatalogTopic(normalized, "gaming.playstation");

  assert.equal(normalized.catalogId, "global.v1");
  assert.deepEqual(tag?.hashtags, ["playstation5", "playstationfive", "ps5"]);
  assert.deepEqual(tag?.variants, ["playstation5", "playstationfive", "ps5"]);
  assert.equal(tag?.entityRefs?.[0]?.source, "wikidata");
  assert.equal(tag?.entityRefs?.[0]?.id, "Q63184502");
  assert.equal(topic?.entityRefs?.some((entity) => entity.source === "dbpedia" && entity.id === "PlayStation_5"), true);
});

test("recommendation catalog accepts common Wikidata and localized DBpedia entity hosts", () => {
  const baseCatalog = catalog();
  const gamingTopic = baseCatalog.topics[0];
  const playstationTopic = baseCatalog.topics[1];
  assert.ok(gamingTopic);
  assert.ok(playstationTopic);

  const normalized = normalizeRecommendationCatalog({
    ...baseCatalog,
    topics: [
      { ...gamingTopic },
      {
        ...playstationTopic,
        entityRefs: [
          {
            source: "wikidata",
            id: "Q63184502",
            uri: "https://wikidata.org/wiki/Q63184502"
          },
          {
            source: "dbpedia",
            id: "PlayStation_5",
            uri: "https://es.dbpedia.org/resource/PlayStation_5"
          }
        ]
      }
    ]
  });

  assert.equal(findRecommendationCatalogTopic(normalized, "gaming.playstation")?.entityRefs?.length, 2);
});

test("recommendation catalog reuses trusted normalized catalog objects only", () => {
  const normalized = normalizeRecommendationCatalog(catalog());
  const forgedFrozenCatalog = Object.freeze({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: "Bad Catalog Id",
    topics: Object.freeze([]),
    canonicalTags: Object.freeze([])
  });

  assert.equal(normalizeRecommendationCatalog(normalized), normalized);
  assert.throws(() => normalizeRecommendationCatalog(forgedFrozenCatalog), TypeError);
});

test("recommendation catalog resolves messy hashtag variants to canonical tags", () => {
  const normalized = normalizeRecommendationCatalog(catalog());

  assert.equal(resolveRecommendationCanonicalTagForHashtag(normalized, "#PS5")?.id, "ps5");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(normalized, "PlayStationFive")?.id, "ps5");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(normalized, "#unknown"), null);
});

test("recommendation onboarding selections default to local app storage and no auto-follow", () => {
  const normalized = normalizeRecommendationCatalog(catalog());
  const selection = createRecommendationOnboardingSelection({
    catalog: normalized,
    selectedTopicIds: ["gaming"],
    selectedAt: "2026-05-17T00:00:00.000Z"
  });
  const plan = createRecommendationHashtagFollowPlan({ catalog: normalized, selection });

  assert.equal(selection.storageTarget, "local_app");
  assert.equal(selection.allowAutoFollowHashtags, false);
  assert.deepEqual(selection.expandedCanonicalTagIds, ["ps5"]);
  assert.deepEqual(plan.hashtags, []);
  assert.equal(plan.requiresAccountFollowAction, false);
});

test("recommendation hashtag follow plans require explicit auto-follow consent", () => {
  const normalized = normalizeRecommendationCatalog(catalog());
  const selection = createRecommendationOnboardingSelection({
    catalog: normalized,
    selectedTopicIds: ["gaming"],
    allowAutoFollowHashtags: true,
    selectedAt: "2026-05-17T00:00:00.000Z",
    storageTarget: "activitypods_pod"
  });
  const plan = createRecommendationHashtagFollowPlan({ catalog: normalized, selection });

  assert.equal(selection.storageTarget, "activitypods_pod");
  assert.equal(plan.allowAutoFollowHashtags, true);
  assert.deepEqual(plan.canonicalTagIds, ["ps5"]);
  assert.deepEqual(plan.hashtags, ["playstation5", "playstationfive", "ps5"]);
  assert.equal(plan.requiresAccountFollowAction, true);
});

test("recommendation catalog rejects unsafe identifiers and broken links", () => {
  assert.throws(
    () => normalizeRecommendationCatalog({
      ...catalog(),
      topics: [
        ...catalog().topics,
        {
          id: "gaming.bad",
          kind: "subtopic",
          label: "Bad",
          primaryTopicId: "missing"
        }
      ]
    }),
    TypeError
  );

  assert.throws(
    () => normalizeRecommendationCatalog({
      ...catalog(),
      canonicalTags: [
        {
          id: "bad",
          displayLabel: "Bad",
          variants: ["bad"],
          hashtags: ["https://example.com/bad"]
        }
      ]
    }),
    TypeError
  );

  assert.throws(
    () => normalizeRecommendationCatalog({
      ...catalog(),
      canonicalTags: [
        {
          id: "bad",
          displayLabel: "Bad",
          variants: ["bad"],
          hashtags: ["#bad"],
          entityRefs: [{ source: "wikidata", id: "PlayStation_5" }]
        }
      ]
    }),
    TypeError
  );
});

test("recommendation catalog rejects subtopic ownership drift", () => {
  assert.throws(
    () => normalizeRecommendationCatalog({
      ...catalog(),
      topics: [
        ...catalog().topics,
        {
          id: "sports",
          kind: "primary",
          label: "Sports"
        },
        {
          id: "sports.nba",
          kind: "subtopic",
          label: "NBA",
          primaryTopicId: "sports",
          canonicalTagIds: ["ps5"]
        }
      ].map((topic) => topic.id === "gaming" ? { ...topic, subtopicIds: ["gaming.playstation", "sports.nba"] } : topic)
    }),
    TypeError
  );
});
