import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_GLOBAL_CATALOG_ID,
  RECOMMENDATION_GLOBAL_CATALOG_LOCALE,
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  createRecommendationHashtagFollowPlan,
  createRecommendationOnboardingSelection,
  findRecommendationCatalogTopic,
  normalizeRecommendationCatalog,
  resolveRecommendationCanonicalTagForHashtag
} from "../src/index.js";

test("global recommendation catalog is normalized and large enough for onboarding", () => {
  const catalog = normalizeRecommendationCatalog(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const primaryTopics = catalog.topics.filter((topic) => topic.kind === "primary");
  const subtopics = catalog.topics.filter((topic) => topic.kind === "subtopic");

  assert.equal(catalog.catalogId, RECOMMENDATION_GLOBAL_CATALOG_ID);
  assert.equal(catalog.locale, RECOMMENDATION_GLOBAL_CATALOG_LOCALE);
  assert.equal(primaryTopics.length, 33);
  assert.equal(subtopics.length, 99);
  assert.equal(catalog.canonicalTags.length, 132);
  assert.equal(normalizeRecommendationCatalog(catalog), catalog);
});

test("global recommendation catalog keeps large standalone categories first-class", () => {
  const standaloneIds = ["anime", "k-pop", "nba", "nfl", "apple", "ai"];

  for (const id of standaloneIds) {
    const topic = findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, id);
    assert.equal(topic?.kind, "primary");
    assert.equal(topic?.popularityTier, "global_standalone");
    assert.deepEqual(topic?.canonicalTagIds, [id]);
    assert.ok((topic?.subtopicIds?.length ?? 0) >= 3);
  }
});

test("global recommendation catalog marks sensitive onboarding categories explicitly", () => {
  assert.equal(findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, "politics")?.sensitive, true);
  assert.equal(findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, "politics.us")?.sensitive, true);
  assert.equal(findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, "mental-health-wellness")?.sensitive, true);
  assert.equal(findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, "mental-health-wellness.therapy")?.sensitive, true);
  assert.equal(findRecommendationCatalogTopic(RECOMMENDATION_GLOBAL_CATALOG_V1, "anime")?.sensitive, undefined);
});

test("global recommendation catalog resolves primary and subtopic canonical hashtag variants", () => {
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#Gaming")?.id, "gaming");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#Music")?.id, "music");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#PS5")?.id, "gaming.playstation");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#PlayStationFive")?.id, "gaming.playstation");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#KPopFedi")?.id, "k-pop.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#NBAFinals")?.id, "nba.events");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#WWDC26")?.id, "apple.events");
});

test("global recommendation catalog avoids duplicate hashtag shadowing for EV and streaming tags", () => {
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#EV")?.id, "automobiles-evs.ev");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#GreenTransportation")?.id, "eco-friendly.ev");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#Streamer")?.id, "content-creators.core");
  assert.equal(resolveRecommendationCanonicalTagForHashtag(RECOMMENDATION_GLOBAL_CATALOG_V1, "#GameStreaming")?.id, "esports-game-streaming.streaming");
});

test("global recommendation catalog drives opt-in hashtag follow plans", () => {
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["anime", "apple", "nba"],
    allowAutoFollowHashtags: true,
    selectedAt: "2026-05-19T00:00:00.000Z",
    storageTarget: "local_app"
  });
  const plan = createRecommendationHashtagFollowPlan({ catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selection });

  assert.equal(plan.requiresAccountFollowAction, true);
  assert.ok(plan.hashtags.includes("anime"));
  assert.ok(plan.hashtags.includes("apple"));
  assert.ok(plan.hashtags.includes("iphone"));
  assert.ok(plan.hashtags.includes("nba"));
  assert.ok(plan.hashtags.includes("nbafinals"));
});

test("global recommendation catalog includes primary topic hashtags in follow plans", () => {
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming", "music"],
    allowAutoFollowHashtags: true,
    selectedAt: "2026-05-19T00:00:00.000Z"
  });
  const plan = createRecommendationHashtagFollowPlan({ catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selection });

  assert.ok(plan.hashtags.includes("gaming"));
  assert.ok(plan.hashtags.includes("music"));
  assert.ok(plan.hashtags.includes("ps5"));
  assert.ok(plan.hashtags.includes("newmusic"));
});
