import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  normalizeRecommendationCatalog,
  type RecommendationCanonicalTag,
  type RecommendationCatalog,
  type RecommendationCatalogEntityRef,
  type RecommendationCatalogTopic
} from "./catalog.js";
import { RECOMMENDATION_GLOBAL_CATALOG_V1 } from "./global-catalog.js";

export const RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID = "global.entity.v1" as const;

const ENTITY_REFS_BY_TARGET_ID: Readonly<Record<string, readonly RecommendationCatalogEntityRef[]>> = Object.freeze({
  "ai": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q11660", label: "Artificial intelligence", uri: "https://www.wikidata.org/wiki/Q11660" }),
    Object.freeze({ source: "dbpedia", id: "Artificial_intelligence", label: "Artificial intelligence", uri: "https://dbpedia.org/resource/Artificial_intelligence" })
  ]),
  "ai.generative": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q11660", label: "Artificial intelligence", uri: "https://www.wikidata.org/wiki/Q11660" }),
    Object.freeze({ source: "dbpedia", id: "Artificial_intelligence", label: "Artificial intelligence", uri: "https://dbpedia.org/resource/Artificial_intelligence" })
  ]),
  "anime": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q1107", label: "Anime", uri: "https://www.wikidata.org/wiki/Q1107" }),
    Object.freeze({ source: "dbpedia", id: "Anime", label: "Anime", uri: "https://dbpedia.org/resource/Anime" })
  ]),
  "anime.core": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q1107", label: "Anime", uri: "https://www.wikidata.org/wiki/Q1107" }),
    Object.freeze({ source: "dbpedia", id: "Anime", label: "Anime", uri: "https://dbpedia.org/resource/Anime" })
  ]),
  "apple": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q312", label: "Apple Inc.", uri: "https://www.wikidata.org/wiki/Q312" }),
    Object.freeze({ source: "dbpedia", id: "Apple_Inc.", label: "Apple Inc.", uri: "https://dbpedia.org/resource/Apple_Inc." })
  ]),
  "apple.products": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q312", label: "Apple Inc.", uri: "https://www.wikidata.org/wiki/Q312" }),
    Object.freeze({ source: "dbpedia", id: "Apple_Inc.", label: "Apple Inc.", uri: "https://dbpedia.org/resource/Apple_Inc." })
  ]),
  "gaming.playstation": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q63184502", label: "PlayStation 5", uri: "https://www.wikidata.org/wiki/Q63184502" }),
    Object.freeze({ source: "dbpedia", id: "PlayStation_5", label: "PlayStation 5", uri: "https://dbpedia.org/resource/PlayStation_5" })
  ]),
  "k-pop": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q213665", label: "K-pop", uri: "https://www.wikidata.org/wiki/Q213665" }),
    Object.freeze({ source: "dbpedia", id: "K-pop", label: "K-pop", uri: "https://dbpedia.org/resource/K-pop" })
  ]),
  "k-pop.core": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q213665", label: "K-pop", uri: "https://www.wikidata.org/wiki/Q213665" }),
    Object.freeze({ source: "dbpedia", id: "K-pop", label: "K-pop", uri: "https://dbpedia.org/resource/K-pop" })
  ]),
  "nba": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q155223", label: "National Basketball Association", uri: "https://www.wikidata.org/wiki/Q155223" }),
    Object.freeze({ source: "dbpedia", id: "National_Basketball_Association", label: "National Basketball Association", uri: "https://dbpedia.org/resource/National_Basketball_Association" })
  ]),
  "nba.core": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q155223", label: "National Basketball Association", uri: "https://www.wikidata.org/wiki/Q155223" }),
    Object.freeze({ source: "dbpedia", id: "National_Basketball_Association", label: "National Basketball Association", uri: "https://dbpedia.org/resource/National_Basketball_Association" })
  ]),
  "nfl": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q1215884", label: "National Football League", uri: "https://www.wikidata.org/wiki/Q1215884" }),
    Object.freeze({ source: "dbpedia", id: "National_Football_League", label: "National Football League", uri: "https://dbpedia.org/resource/National_Football_League" })
  ]),
  "nfl.core": Object.freeze([
    Object.freeze({ source: "wikidata", id: "Q1215884", label: "National Football League", uri: "https://www.wikidata.org/wiki/Q1215884" }),
    Object.freeze({ source: "dbpedia", id: "National_Football_League", label: "National Football League", uri: "https://dbpedia.org/resource/National_Football_League" })
  ])
});

function appendUnique(values: readonly string[] | undefined, value: string): readonly string[] {
  return Object.freeze([...new Set([...(values ?? []), value])]);
}

function withEntityRefs<T extends RecommendationCatalogTopic | RecommendationCanonicalTag>(item: T): T {
  const entityRefs = ENTITY_REFS_BY_TARGET_ID[item.id];
  if (entityRefs === undefined) {
    return item;
  }

  return Object.freeze({ ...item, entityRefs }) as unknown as T;
}

function withCatalogCoverageFixes(item: RecommendationCatalogTopic): RecommendationCatalogTopic {
  if (item.id !== "content-creators.core") {
    return withEntityRefs(item);
  }

  return withEntityRefs(Object.freeze({
    ...item,
    hashtags: appendUnique(item.hashtags, "#Streamers")
  }));
}

function withCanonicalTagCoverageFixes(item: RecommendationCanonicalTag): RecommendationCanonicalTag {
  if (item.id !== "content-creators.core") {
    return withEntityRefs(item);
  }

  return withEntityRefs(Object.freeze({
    ...item,
    variants: appendUnique(item.variants, "Streamers"),
    hashtags: appendUnique(item.hashtags, "#Streamers")
  }));
}

export function createEntityEnrichedRecommendationCatalog(catalog: RecommendationCatalog): RecommendationCatalog {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);

  return normalizeRecommendationCatalog({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: RECOMMENDATION_GLOBAL_ENTITY_CATALOG_ID,
    locale: normalizedCatalog.locale,
    topics: normalizedCatalog.topics.map(withCatalogCoverageFixes),
    canonicalTags: normalizedCatalog.canonicalTags.map(withCanonicalTagCoverageFixes)
  });
}

export const RECOMMENDATION_GLOBAL_ENTITY_CATALOG_V1 = createEntityEnrichedRecommendationCatalog(RECOMMENDATION_GLOBAL_CATALOG_V1);