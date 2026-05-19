import {
  RECOMMENDATION_CATALOG_ENTITY_SOURCES,
  normalizeRecommendationCatalog,
  type RecommendationCanonicalTag,
  type RecommendationCatalog,
  type RecommendationCatalogEntityRef,
  type RecommendationCatalogEntitySource,
  type RecommendationCatalogTopic
} from "./catalog.js";

export interface RecommendationCatalogEntityLookupInput {
  source: RecommendationCatalogEntitySource;
  id: string;
}

export interface RecommendationCatalogEntityResolution {
  entityRef: RecommendationCatalogEntityRef;
  topics: readonly RecommendationCatalogTopic[];
  canonicalTags: readonly RecommendationCanonicalTag[];
  topicIds: readonly string[];
  canonicalTagIds: readonly string[];
}

const ENTITY_SOURCE_SET = new Set<string>(RECOMMENDATION_CATALOG_ENTITY_SOURCES);
const WIKIDATA_ID_PATTERN = /^Q[1-9][0-9]{0,15}$/u;
const DBPEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_()'.,-]{0,255}$/u;

function normalizeEntityLookupInput(input: RecommendationCatalogEntityLookupInput): RecommendationCatalogEntityLookupInput {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid recommendation catalog entity lookup input.");
  }
  if (!ENTITY_SOURCE_SET.has(input.source)) {
    throw new TypeError("Invalid recommendation catalog entity lookup source.");
  }
  if (typeof input.id !== "string" || input.id.trim() !== input.id || input.id.length === 0 || input.id.length > 256) {
    throw new TypeError("Invalid recommendation catalog entity lookup id.");
  }
  if (input.source === "wikidata" && !WIKIDATA_ID_PATTERN.test(input.id)) {
    throw new TypeError("Invalid recommendation catalog Wikidata lookup id.");
  }
  if (input.source === "dbpedia" && (!DBPEDIA_ID_PATTERN.test(input.id) || input.id.includes("://"))) {
    throw new TypeError("Invalid recommendation catalog DBpedia lookup id.");
  }

  return { source: input.source, id: input.id };
}

function entityKey(entity: RecommendationCatalogEntityLookupInput): string {
  return `${entity.source}:${entity.id}`;
}

function sameEntityRef(ref: RecommendationCatalogEntityRef, lookup: RecommendationCatalogEntityLookupInput): boolean {
  return ref.source === lookup.source && ref.id === lookup.id;
}

export function resolveRecommendationCatalogEntity(
  catalog: RecommendationCatalog,
  input: RecommendationCatalogEntityLookupInput
): RecommendationCatalogEntityResolution | null {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);
  const lookup = normalizeEntityLookupInput(input);
  const topicMap = new Map<string, RecommendationCatalogTopic>();
  const catalogTopicMap = new Map(normalizedCatalog.topics.map((topic) => [topic.id, topic]));
  const canonicalTagMap = new Map<string, RecommendationCanonicalTag>();
  let representativeRef: RecommendationCatalogEntityRef | null = null;

  for (const topic of normalizedCatalog.topics) {
    const ref = topic.entityRefs?.find((entityRef) => sameEntityRef(entityRef, lookup));
    if (ref !== undefined) {
      topicMap.set(topic.id, topic);
      representativeRef ??= ref;
    }
  }

  for (const tag of normalizedCatalog.canonicalTags) {
    const ref = tag.entityRefs?.find((entityRef) => sameEntityRef(entityRef, lookup));
    if (ref !== undefined) {
      canonicalTagMap.set(tag.id, tag);
      representativeRef ??= ref;
      for (const topicId of tag.parentTopicIds ?? []) {
        const topic = catalogTopicMap.get(topicId);
        if (topic !== undefined) {
          topicMap.set(topic.id, topic);
        }
      }
    }
  }

  if (representativeRef === null) {
    return null;
  }

  const topics = Object.freeze([...topicMap.values()].sort((left, right) => left.id.localeCompare(right.id)));
  const canonicalTags = Object.freeze([...canonicalTagMap.values()].sort((left, right) => left.id.localeCompare(right.id)));

  return Object.freeze({
    entityRef: representativeRef,
    topics,
    canonicalTags,
    topicIds: Object.freeze(topics.map((topic) => topic.id)),
    canonicalTagIds: Object.freeze(canonicalTags.map((tag) => tag.id))
  });
}

export function findRecommendationCatalogTopicsForEntity(
  catalog: RecommendationCatalog,
  input: RecommendationCatalogEntityLookupInput
): readonly RecommendationCatalogTopic[] {
  return resolveRecommendationCatalogEntity(catalog, input)?.topics ?? Object.freeze([]);
}

export function findRecommendationCanonicalTagsForEntity(
  catalog: RecommendationCatalog,
  input: RecommendationCatalogEntityLookupInput
): readonly RecommendationCanonicalTag[] {
  return resolveRecommendationCatalogEntity(catalog, input)?.canonicalTags ?? Object.freeze([]);
}

export function hasRecommendationCatalogEntity(
  catalog: RecommendationCatalog,
  input: RecommendationCatalogEntityLookupInput
): boolean {
  return resolveRecommendationCatalogEntity(catalog, input) !== null;
}

export function createRecommendationCatalogEntityKey(input: RecommendationCatalogEntityLookupInput): string {
  return entityKey(normalizeEntityLookupInput(input));
}