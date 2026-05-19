import { normalizeHashtag, normalizeString } from "../normalization/hashtags.js";
import {
  normalizeRecommendationCatalog,
  type RecommendationCanonicalTag,
  type RecommendationCatalog,
  type RecommendationCatalogEntityRef,
  type RecommendationCatalogTopic
} from "./catalog.js";
import {
  createRecommendationCatalogEntityKey,
  type RecommendationCatalogEntityLookupInput,
  type RecommendationCatalogEntityResolution
} from "./catalog-entity-resolution.js";

export interface RecommendationCatalogIndexOptions {
  rejectAmbiguousTagMatches?: boolean;
}

export interface RecommendationCatalogTagTokenCollision {
  normalizedToken: string;
  canonicalTagIds: readonly string[];
  resolvedCanonicalTagId: string;
  maxSpecificity: number;
  ambiguous: boolean;
}

export interface RecommendationCatalogIndex {
  catalog: RecommendationCatalog;
  topicsById: ReadonlyMap<string, RecommendationCatalogTopic>;
  primaryTopicsById: ReadonlyMap<string, RecommendationCatalogTopic>;
  subtopicsById: ReadonlyMap<string, RecommendationCatalogTopic>;
  canonicalTagsById: ReadonlyMap<string, RecommendationCanonicalTag>;
  canonicalTagIdsByTopicId: ReadonlyMap<string, readonly string[]>;
  canonicalTagIdsByNormalizedToken: ReadonlyMap<string, readonly string[]>;
  canonicalTagByNormalizedToken: ReadonlyMap<string, RecommendationCanonicalTag>;
  tagTokenCollisions: readonly RecommendationCatalogTagTokenCollision[];
  entityRefsByKey: ReadonlyMap<string, RecommendationCatalogEntityRef>;
  topicIdsByEntityKey: ReadonlyMap<string, readonly string[]>;
  canonicalTagIdsByEntityKey: ReadonlyMap<string, readonly string[]>;
}

const MAX_ID_LENGTH = 160;
const MAX_TOKEN_LENGTH = 160;
const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,158}[a-z0-9])?$/u;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function normalizeCatalogIndexId(value: string, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value || hasControlCharacter(value)) {
    throw new TypeError(message);
  }

  const normalized = normalizeString(value);
  if (normalized !== value || normalized.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(normalized)) {
    throw new TypeError(message);
  }

  return normalized;
}

function normalizeLookupToken(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value || hasControlCharacter(value)) {
    throw new TypeError("Invalid recommendation catalog lookup token.");
  }

  const normalized = normalizeHashtag(value);
  if (normalized.length === 0 || normalized.length > MAX_TOKEN_LENGTH || normalized.includes("://") || normalized.includes("@")) {
    throw new TypeError("Invalid recommendation catalog lookup token.");
  }

  return normalized;
}

function entityKey(ref: RecommendationCatalogEntityRef): string {
  return `${ref.source}:${ref.id}`;
}

function addToStringSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  let values = map.get(key);
  if (values === undefined) {
    values = new Set<string>();
    map.set(key, values);
  }
  values.add(value);
}

function freezeStringArrayMap(map: Map<string, Set<string>>): ReadonlyMap<string, readonly string[]> {
  return new Map(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, Object.freeze([...values].sort())] as const)
  );
}

function tagSpecificity(tag: RecommendationCanonicalTag, topicMap: ReadonlyMap<string, RecommendationCatalogTopic>): number {
  let specificity = 0;
  for (const topicId of tag.parentTopicIds ?? []) {
    const topic = topicMap.get(topicId);
    if (topic?.kind === "subtopic") {
      specificity = Math.max(specificity, 2);
    } else if (topic?.kind === "primary") {
      specificity = Math.max(specificity, 1);
    }
  }

  return specificity;
}

function bestTagForToken(
  tags: readonly RecommendationCanonicalTag[],
  topicMap: ReadonlyMap<string, RecommendationCatalogTopic>
): { tag: RecommendationCanonicalTag; maxSpecificity: number; ambiguous: boolean } {
  let bestTag: RecommendationCanonicalTag | undefined;
  let maxSpecificity = -1;
  let maxSpecificityMatches = 0;

  for (const tag of tags) {
    const specificity = tagSpecificity(tag, topicMap);
    if (specificity > maxSpecificity) {
      bestTag = tag;
      maxSpecificity = specificity;
      maxSpecificityMatches = 1;
    } else if (specificity === maxSpecificity) {
      maxSpecificityMatches += 1;
    }
  }

  if (bestTag === undefined) {
    throw new TypeError("Invalid recommendation catalog token index state.");
  }

  return { tag: bestTag, maxSpecificity, ambiguous: maxSpecificityMatches > 1 };
}

function createTagTokenIndexes(
  catalog: RecommendationCatalog,
  topicMap: ReadonlyMap<string, RecommendationCatalogTopic>,
  tagMap: ReadonlyMap<string, RecommendationCanonicalTag>,
  options: RecommendationCatalogIndexOptions
): Pick<RecommendationCatalogIndex, "canonicalTagIdsByNormalizedToken" | "canonicalTagByNormalizedToken" | "tagTokenCollisions"> {
  const tokenToTagIds = new Map<string, Set<string>>();

  for (const tag of catalog.canonicalTags) {
    const tokens = new Set([...tag.hashtags, ...tag.variants]);
    for (const token of tokens) {
      addToStringSetMap(tokenToTagIds, token, tag.id);
    }
  }

  const canonicalTagByNormalizedToken = new Map<string, RecommendationCanonicalTag>();
  const tagTokenCollisions: RecommendationCatalogTagTokenCollision[] = [];

  for (const [token, tagIds] of [...tokenToTagIds.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const tags = [...tagIds]
      .sort()
      .map((tagId) => tagMap.get(tagId))
      .filter((tag): tag is RecommendationCanonicalTag => tag !== undefined);
    const best = bestTagForToken(tags, topicMap);
    canonicalTagByNormalizedToken.set(token, best.tag);

    if (tags.length > 1) {
      const collision = Object.freeze({
        normalizedToken: token,
        canonicalTagIds: Object.freeze(tags.map((tag) => tag.id)),
        resolvedCanonicalTagId: best.tag.id,
        maxSpecificity: best.maxSpecificity,
        ambiguous: best.ambiguous
      });
      if (options.rejectAmbiguousTagMatches === true && collision.ambiguous) {
        throw new TypeError("Ambiguous recommendation catalog token collision.");
      }
      tagTokenCollisions.push(collision);
    }
  }

  return {
    canonicalTagIdsByNormalizedToken: freezeStringArrayMap(tokenToTagIds),
    canonicalTagByNormalizedToken: new Map([...canonicalTagByNormalizedToken.entries()].sort(([left], [right]) => left.localeCompare(right))),
    tagTokenCollisions: Object.freeze(tagTokenCollisions.sort((left, right) => left.normalizedToken.localeCompare(right.normalizedToken)))
  };
}

export function createRecommendationCatalogIndex(
  catalog: RecommendationCatalog,
  options: RecommendationCatalogIndexOptions = {}
): RecommendationCatalogIndex {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);
  const topicsById = new Map<string, RecommendationCatalogTopic>();
  const primaryTopicsById = new Map<string, RecommendationCatalogTopic>();
  const subtopicsById = new Map<string, RecommendationCatalogTopic>();
  const canonicalTagsById = new Map<string, RecommendationCanonicalTag>();
  const tagIdsByTopicId = new Map<string, Set<string>>();
  const entityRefsByKey = new Map<string, RecommendationCatalogEntityRef>();
  const topicIdsByEntityKey = new Map<string, Set<string>>();
  const canonicalTagIdsByEntityKey = new Map<string, Set<string>>();

  for (const topic of normalizedCatalog.topics) {
    topicsById.set(topic.id, topic);
    if (topic.kind === "primary") {
      primaryTopicsById.set(topic.id, topic);
    } else {
      subtopicsById.set(topic.id, topic);
    }
    for (const tagId of topic.canonicalTagIds ?? []) {
      addToStringSetMap(tagIdsByTopicId, topic.id, tagId);
    }
    for (const ref of topic.entityRefs ?? []) {
      const key = entityKey(ref);
      entityRefsByKey.set(key, entityRefsByKey.get(key) ?? ref);
      addToStringSetMap(topicIdsByEntityKey, key, topic.id);
    }
  }

  for (const tag of normalizedCatalog.canonicalTags) {
    canonicalTagsById.set(tag.id, tag);
    for (const topicId of tag.parentTopicIds ?? []) {
      addToStringSetMap(tagIdsByTopicId, topicId, tag.id);
    }
    for (const ref of tag.entityRefs ?? []) {
      const key = entityKey(ref);
      entityRefsByKey.set(key, entityRefsByKey.get(key) ?? ref);
      addToStringSetMap(canonicalTagIdsByEntityKey, key, tag.id);
      for (const topicId of tag.parentTopicIds ?? []) {
        addToStringSetMap(topicIdsByEntityKey, key, topicId);
      }
    }
  }

  const tokenIndexes = createTagTokenIndexes(normalizedCatalog, topicsById, canonicalTagsById, options);

  return Object.freeze({
    catalog: normalizedCatalog,
    topicsById: new Map([...topicsById.entries()].sort(([left], [right]) => left.localeCompare(right))),
    primaryTopicsById: new Map([...primaryTopicsById.entries()].sort(([left], [right]) => left.localeCompare(right))),
    subtopicsById: new Map([...subtopicsById.entries()].sort(([left], [right]) => left.localeCompare(right))),
    canonicalTagsById: new Map([...canonicalTagsById.entries()].sort(([left], [right]) => left.localeCompare(right))),
    canonicalTagIdsByTopicId: freezeStringArrayMap(tagIdsByTopicId),
    canonicalTagIdsByNormalizedToken: tokenIndexes.canonicalTagIdsByNormalizedToken,
    canonicalTagByNormalizedToken: tokenIndexes.canonicalTagByNormalizedToken,
    tagTokenCollisions: tokenIndexes.tagTokenCollisions,
    entityRefsByKey: new Map([...entityRefsByKey.entries()].sort(([left], [right]) => left.localeCompare(right))),
    topicIdsByEntityKey: freezeStringArrayMap(topicIdsByEntityKey),
    canonicalTagIdsByEntityKey: freezeStringArrayMap(canonicalTagIdsByEntityKey)
  });
}

export function findRecommendationCatalogTopicInIndex(
  index: RecommendationCatalogIndex,
  topicId: string
): RecommendationCatalogTopic | null {
  const normalizedTopicId = normalizeCatalogIndexId(topicId, "Invalid recommendation catalog topic id.");
  return index.topicsById.get(normalizedTopicId) ?? null;
}

export function findRecommendationCanonicalTagInIndex(
  index: RecommendationCatalogIndex,
  canonicalTagId: string
): RecommendationCanonicalTag | null {
  const normalizedTagId = normalizeCatalogIndexId(canonicalTagId, "Invalid recommendation canonical tag id.");
  return index.canonicalTagsById.get(normalizedTagId) ?? null;
}

export function resolveRecommendationCanonicalTagFromIndex(
  index: RecommendationCatalogIndex,
  token: string
): RecommendationCanonicalTag | null {
  const normalizedToken = normalizeLookupToken(token);
  return index.canonicalTagByNormalizedToken.get(normalizedToken) ?? null;
}

export function resolveRecommendationCatalogEntityFromIndex(
  index: RecommendationCatalogIndex,
  input: RecommendationCatalogEntityLookupInput
): RecommendationCatalogEntityResolution | null {
  const key = createRecommendationCatalogEntityKey(input);
  const entityRef = index.entityRefsByKey.get(key);
  if (entityRef === undefined) {
    return null;
  }

  const topicIds = index.topicIdsByEntityKey.get(key) ?? Object.freeze([]);
  const canonicalTagIds = index.canonicalTagIdsByEntityKey.get(key) ?? Object.freeze([]);
  const topics = topicIds
    .map((topicId) => index.topicsById.get(topicId))
    .filter((topic): topic is RecommendationCatalogTopic => topic !== undefined);
  const canonicalTags = canonicalTagIds
    .map((tagId) => index.canonicalTagsById.get(tagId))
    .filter((tag): tag is RecommendationCanonicalTag => tag !== undefined);

  return Object.freeze({
    entityRef,
    topics: Object.freeze(topics),
    canonicalTags: Object.freeze(canonicalTags),
    topicIds,
    canonicalTagIds
  });
}
