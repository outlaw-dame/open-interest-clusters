import { normalizeHashtag, normalizeString } from "../normalization/hashtags.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export const RECOMMENDATION_CATALOG_SCHEMA_VERSION = "recommendation-catalog.v1" as const;
export const RECOMMENDATION_ONBOARDING_SELECTION_SCHEMA_VERSION = "recommendation-onboarding-selection.v1" as const;
export const RECOMMENDATION_HASHTAG_FOLLOW_PLAN_SCHEMA_VERSION = "recommendation-hashtag-follow-plan.v1" as const;

export const RECOMMENDATION_CATALOG_TOPIC_KINDS = ["primary", "subtopic"] as const;
export type RecommendationCatalogTopicKind = typeof RECOMMENDATION_CATALOG_TOPIC_KINDS[number];

export const RECOMMENDATION_CATALOG_POPULARITY_TIERS = [
  "global_standalone",
  "global_primary",
  "regional_primary",
  "domain_primary",
  "niche",
  "app_specific"
] as const;
export type RecommendationCatalogPopularityTier = typeof RECOMMENDATION_CATALOG_POPULARITY_TIERS[number];

export const RECOMMENDATION_CATALOG_ENTITY_SOURCES = ["wikidata", "dbpedia"] as const;
export type RecommendationCatalogEntitySource = typeof RECOMMENDATION_CATALOG_ENTITY_SOURCES[number];

export const RECOMMENDATION_PREFERENCE_STORAGE_TARGETS = [
  "local_app",
  "activitypods_pod",
  "solid_pod",
  "encrypted_sync",
  "provider_storage"
] as const;
export type RecommendationPreferenceStorageTarget = typeof RECOMMENDATION_PREFERENCE_STORAGE_TARGETS[number];

export interface RecommendationCatalogEntityRef {
  source: RecommendationCatalogEntitySource;
  id: string;
  label?: string;
  uri?: string;
}

export interface RecommendationCanonicalTag {
  id: string;
  displayLabel: string;
  variants: readonly string[];
  hashtags: readonly string[];
  entityRefs?: readonly RecommendationCatalogEntityRef[];
  parentTopicIds?: readonly string[];
}

export interface RecommendationCatalogTopic {
  id: string;
  kind: RecommendationCatalogTopicKind;
  label: string;
  popularityTier?: RecommendationCatalogPopularityTier;
  primaryTopicId?: string;
  subtopicIds?: readonly string[];
  canonicalTagIds?: readonly string[];
  keywords?: readonly string[];
  hashtags?: readonly string[];
  entityRefs?: readonly RecommendationCatalogEntityRef[];
  sensitive?: boolean;
}

export interface RecommendationCatalog {
  schemaVersion: typeof RECOMMENDATION_CATALOG_SCHEMA_VERSION;
  catalogId: string;
  locale?: string;
  topics: readonly RecommendationCatalogTopic[];
  canonicalTags: readonly RecommendationCanonicalTag[];
}

export interface RecommendationOnboardingSelectionInput {
  catalog: RecommendationCatalog;
  selectedTopicIds: readonly string[];
  selectedCanonicalTagIds?: readonly string[];
  allowAutoFollowHashtags?: boolean;
  selectedAt: string;
  storageTarget?: RecommendationPreferenceStorageTarget;
}

export interface RecommendationOnboardingSelectionRecord {
  schemaVersion: typeof RECOMMENDATION_ONBOARDING_SELECTION_SCHEMA_VERSION;
  selectedTopicIds: readonly string[];
  selectedCanonicalTagIds: readonly string[];
  expandedCanonicalTagIds: readonly string[];
  allowAutoFollowHashtags: boolean;
  selectedAt: string;
  storageTarget: RecommendationPreferenceStorageTarget;
}

export interface RecommendationHashtagFollowPlanInput {
  catalog: RecommendationCatalog;
  selection: RecommendationOnboardingSelectionRecord;
}

export interface RecommendationHashtagFollowPlan {
  schemaVersion: typeof RECOMMENDATION_HASHTAG_FOLLOW_PLAN_SCHEMA_VERSION;
  allowAutoFollowHashtags: boolean;
  hashtags: readonly string[];
  canonicalTagIds: readonly string[];
  requiresAccountFollowAction: boolean;
}

const MAX_ID_LENGTH = 160;
const MAX_LABEL_LENGTH = 160;
const MAX_KEYWORD_LENGTH = 160;
const MAX_URI_LENGTH = 512;
const MAX_COLLECTION_SIZE = 10_000;
const TOPIC_KIND_SET = new Set<string>(RECOMMENDATION_CATALOG_TOPIC_KINDS);
const POPULARITY_TIER_SET = new Set<string>(RECOMMENDATION_CATALOG_POPULARITY_TIERS);
const ENTITY_SOURCE_SET = new Set<string>(RECOMMENDATION_CATALOG_ENTITY_SOURCES);
const STORAGE_TARGET_SET = new Set<string>(RECOMMENDATION_PREFERENCE_STORAGE_TARGETS);
const NORMALIZED_RECOMMENDATION_CATALOGS = new WeakSet<RecommendationCatalog>();
const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,158}[a-z0-9])?$/u;
const WIKIDATA_ID_PATTERN = /^Q[1-9][0-9]{0,15}$/u;
const DBPEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_()'.,-]{0,255}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSafeLabel(value: unknown, message: string, maxLength = MAX_LABEL_LENGTH): string {
  if (
    !isNonEmptyString(value) ||
    value.trim() !== value ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }

  return value;
}

function normalizeCatalogId(value: unknown, message = "Invalid recommendation catalog id."): string {
  if (!isNonEmptyString(value)) {
    throw new TypeError(message);
  }

  const normalized = normalizeString(value);
  if (normalized !== value || normalized.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(normalized)) {
    throw new TypeError(message);
  }

  return normalized;
}

function assertTimestamp(value: unknown, message = "Invalid recommendation onboarding timestamp."): string {
  const timestamp = assertSafeLabel(value, message);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(message);
  }

  return timestamp;
}

function normalizeOptionalStringArray(
  value: unknown,
  normalizer: (item: unknown) => string,
  message: string
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE) {
    throw new TypeError(message);
  }

  return normalizeRequiredStringArray(value, normalizer, message, false);
}

function normalizeRequiredStringArray(
  value: unknown,
  normalizer: (item: unknown) => string,
  message: string,
  requireNonEmpty = true
): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE || (requireNonEmpty && value.length === 0)) {
    throw new TypeError(message);
  }

  const normalized = new Set<string>();
  for (const item of value) {
    normalized.add(normalizer(item));
  }

  if (requireNonEmpty && normalized.size === 0) {
    throw new TypeError(message);
  }

  return Object.freeze([...normalized].sort());
}

function normalizeKeyword(value: unknown): string {
  const keyword = assertSafeLabel(value, "Invalid recommendation catalog keyword.", MAX_KEYWORD_LENGTH);
  if (keyword.includes("://") || keyword.includes("@")) {
    throw new TypeError("Invalid recommendation catalog keyword.");
  }

  return normalizeString(keyword);
}

function normalizeHashtagValue(value: unknown): string {
  const hashtag = assertSafeLabel(value, "Invalid recommendation catalog hashtag.", MAX_KEYWORD_LENGTH);
  const normalized = normalizeHashtag(hashtag);
  if (normalized.length === 0 || normalized.length > MAX_KEYWORD_LENGTH || normalized.includes("://") || normalized.includes("@")) {
    throw new TypeError("Invalid recommendation catalog hashtag.");
  }

  return normalized;
}

function normalizeOptionalLocale(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const locale = assertSafeLabel(value, "Invalid recommendation catalog locale.", 35);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(locale)) {
    throw new TypeError("Invalid recommendation catalog locale.");
  }

  return locale;
}

function isAllowedEntityUriHost(hostname: string): boolean {
  return hostname === "wikidata.org" ||
    hostname === "www.wikidata.org" ||
    hostname === "dbpedia.org" ||
    hostname.endsWith(".dbpedia.org");
}

function normalizeOptionalUri(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const uri = assertSafeLabel(value, "Invalid recommendation catalog entity URI.", MAX_URI_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("Invalid recommendation catalog entity URI.");
  }

  if (parsed.protocol !== "https:" || !isAllowedEntityUriHost(parsed.hostname.toLocaleLowerCase("und"))) {
    throw new TypeError("Invalid recommendation catalog entity URI.");
  }

  return uri;
}

function normalizeEntityRef(value: unknown): RecommendationCatalogEntityRef {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation catalog entity reference.");
  }

  const source = value.source;
  if (typeof source !== "string" || !ENTITY_SOURCE_SET.has(source)) {
    throw new TypeError("Invalid recommendation catalog entity source.");
  }

  const id = assertSafeLabel(value.id, "Invalid recommendation catalog entity id.", 256);
  if (source === "wikidata" && !WIKIDATA_ID_PATTERN.test(id)) {
    throw new TypeError("Invalid recommendation catalog Wikidata id.");
  }
  if (source === "dbpedia" && (!DBPEDIA_ID_PATTERN.test(id) || id.includes("://"))) {
    throw new TypeError("Invalid recommendation catalog DBpedia id.");
  }

  const entity: RecommendationCatalogEntityRef = {
    source: source as RecommendationCatalogEntitySource,
    id
  };
  if (value.label !== undefined) {
    entity.label = assertSafeLabel(value.label, "Invalid recommendation catalog entity label.");
  }
  const uri = normalizeOptionalUri(value.uri);
  if (uri !== undefined) {
    entity.uri = uri;
  }

  return Object.freeze(entity);
}

function normalizeEntityRefs(value: unknown): readonly RecommendationCatalogEntityRef[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE) {
    throw new TypeError("Invalid recommendation catalog entity references.");
  }

  const refs = new Map<string, RecommendationCatalogEntityRef>();
  for (const item of value) {
    const ref = normalizeEntityRef(item);
    refs.set(`${ref.source}:${ref.id}`, ref);
  }

  return Object.freeze([...refs.values()].sort((left, right) => `${left.source}:${left.id}`.localeCompare(`${right.source}:${right.id}`)));
}

function normalizeCanonicalTag(value: unknown): RecommendationCanonicalTag {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation canonical tag.");
  }

  const id = normalizeCatalogId(value.id, "Invalid recommendation canonical tag id.");
  const variants = normalizeRequiredStringArray(value.variants, normalizeHashtagValue, "Invalid recommendation canonical tag variants.");
  const hashtags = normalizeRequiredStringArray(value.hashtags, normalizeHashtagValue, "Invalid recommendation canonical tag hashtags.");
  const tag: RecommendationCanonicalTag = {
    id,
    displayLabel: assertSafeLabel(value.displayLabel, "Invalid recommendation canonical tag display label."),
    variants,
    hashtags
  };

  const entityRefs = normalizeEntityRefs(value.entityRefs);
  if (entityRefs !== undefined) {
    tag.entityRefs = entityRefs;
  }

  const parentTopicIds = normalizeOptionalStringArray(value.parentTopicIds, (item) => normalizeCatalogId(item, "Invalid recommendation canonical tag parent topic id."), "Invalid recommendation canonical tag parent topics.");
  if (parentTopicIds !== undefined) {
    tag.parentTopicIds = parentTopicIds;
  }

  return Object.freeze(tag);
}

function normalizeTopic(value: unknown): RecommendationCatalogTopic {
  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation catalog topic.");
  }

  const id = normalizeCatalogId(value.id, "Invalid recommendation catalog topic id.");
  const kind = value.kind;
  if (typeof kind !== "string" || !TOPIC_KIND_SET.has(kind)) {
    throw new TypeError("Invalid recommendation catalog topic kind.");
  }

  const topic: RecommendationCatalogTopic = {
    id,
    kind: kind as RecommendationCatalogTopicKind,
    label: assertSafeLabel(value.label, "Invalid recommendation catalog topic label.")
  };

  if (value.popularityTier !== undefined) {
    if (typeof value.popularityTier !== "string" || !POPULARITY_TIER_SET.has(value.popularityTier)) {
      throw new TypeError("Invalid recommendation catalog popularity tier.");
    }
    topic.popularityTier = value.popularityTier as RecommendationCatalogPopularityTier;
  }

  if (value.primaryTopicId !== undefined) {
    topic.primaryTopicId = normalizeCatalogId(value.primaryTopicId, "Invalid recommendation catalog primary topic id.");
  }

  const subtopicIds = normalizeOptionalStringArray(value.subtopicIds, (item) => normalizeCatalogId(item, "Invalid recommendation catalog subtopic id."), "Invalid recommendation catalog subtopic ids.");
  if (subtopicIds !== undefined) topic.subtopicIds = subtopicIds;

  const canonicalTagIds = normalizeOptionalStringArray(value.canonicalTagIds, (item) => normalizeCatalogId(item, "Invalid recommendation catalog canonical tag id."), "Invalid recommendation catalog canonical tag ids.");
  if (canonicalTagIds !== undefined) topic.canonicalTagIds = canonicalTagIds;

  const keywords = normalizeOptionalStringArray(value.keywords, normalizeKeyword, "Invalid recommendation catalog keywords.");
  if (keywords !== undefined) topic.keywords = keywords;

  const hashtags = normalizeOptionalStringArray(value.hashtags, normalizeHashtagValue, "Invalid recommendation catalog hashtags.");
  if (hashtags !== undefined) topic.hashtags = hashtags;

  const entityRefs = normalizeEntityRefs(value.entityRefs);
  if (entityRefs !== undefined) topic.entityRefs = entityRefs;

  if (value.sensitive !== undefined) {
    if (typeof value.sensitive !== "boolean") {
      throw new TypeError("Invalid recommendation catalog sensitive marker.");
    }
    topic.sensitive = value.sensitive;
  }

  return Object.freeze(topic);
}

function assertCatalogLinks(catalog: RecommendationCatalog): void {
  const topicMap = new Map(catalog.topics.map((topic) => [topic.id, topic]));
  const tagIds = new Set(catalog.canonicalTags.map((tag) => tag.id));

  if (topicMap.size !== catalog.topics.length) {
    throw new TypeError("Duplicate recommendation catalog topic id.");
  }
  if (tagIds.size !== catalog.canonicalTags.length) {
    throw new TypeError("Duplicate recommendation canonical tag id.");
  }

  for (const topic of catalog.topics) {
    if (topic.kind === "primary" && topic.primaryTopicId !== undefined) {
      throw new TypeError("Primary recommendation catalog topic cannot have a parent topic.");
    }
    if (topic.kind === "subtopic") {
      const primaryTopic = topic.primaryTopicId === undefined ? undefined : topicMap.get(topic.primaryTopicId);
      if (primaryTopic === undefined || primaryTopic.kind !== "primary") {
        throw new TypeError("Subtopic recommendation catalog topic must reference a known primary topic.");
      }
      if ((topic.subtopicIds?.length ?? 0) > 0) {
        throw new TypeError("Subtopic recommendation catalog topic cannot reference child subtopics.");
      }
    }
    for (const subtopicId of topic.subtopicIds ?? []) {
      const subtopic = topicMap.get(subtopicId);
      if (subtopic === undefined || subtopic.kind !== "subtopic") {
        throw new TypeError("Recommendation catalog topic references unknown subtopic.");
      }
      if (topic.kind === "primary" && subtopic.primaryTopicId !== topic.id) {
        throw new TypeError("Recommendation catalog topic references subtopic owned by another primary topic.");
      }
    }
    for (const tagId of topic.canonicalTagIds ?? []) {
      if (!tagIds.has(tagId)) {
        throw new TypeError("Recommendation catalog topic references unknown canonical tag.");
      }
    }
  }

  for (const tag of catalog.canonicalTags) {
    for (const topicId of tag.parentTopicIds ?? []) {
      if (!topicMap.has(topicId)) {
        throw new TypeError("Recommendation canonical tag references unknown topic.");
      }
    }
  }
}

export function normalizeRecommendationCatalog(value: unknown): RecommendationCatalog {
  if (isObject(value)) {
    const possibleCatalog = value as unknown as RecommendationCatalog;
    if (NORMALIZED_RECOMMENDATION_CATALOGS.has(possibleCatalog)) {
      return possibleCatalog;
    }
  }

  if (!isObject(value)) {
    throw new TypeError("Invalid recommendation catalog.");
  }

  if (value.schemaVersion !== RECOMMENDATION_CATALOG_SCHEMA_VERSION) {
    throw new TypeError("Invalid recommendation catalog schema version.");
  }

  if (!Array.isArray(value.topics) || !Array.isArray(value.canonicalTags) || value.topics.length > MAX_COLLECTION_SIZE || value.canonicalTags.length > MAX_COLLECTION_SIZE) {
    throw new TypeError("Invalid recommendation catalog collections.");
  }

  const catalog: RecommendationCatalog = {
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: normalizeCatalogId(value.catalogId),
    topics: Object.freeze(value.topics.map(normalizeTopic).sort((left, right) => left.id.localeCompare(right.id))),
    canonicalTags: Object.freeze(value.canonicalTags.map(normalizeCanonicalTag).sort((left, right) => left.id.localeCompare(right.id)))
  };

  const locale = normalizeOptionalLocale(value.locale);
  if (locale !== undefined) {
    catalog.locale = locale;
  }

  assertCatalogLinks(catalog);
  NORMALIZED_RECOMMENDATION_CATALOGS.add(catalog);
  return Object.freeze(catalog);
}

export function findRecommendationCatalogTopic(catalog: RecommendationCatalog, topicId: string): RecommendationCatalogTopic | null {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);
  const normalizedTopicId = normalizeCatalogId(topicId, "Invalid recommendation catalog topic id.");
  return normalizedCatalog.topics.find((topic) => topic.id === normalizedTopicId) ?? null;
}

export function findRecommendationCanonicalTag(catalog: RecommendationCatalog, canonicalTagId: string): RecommendationCanonicalTag | null {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);
  const normalizedTagId = normalizeCatalogId(canonicalTagId, "Invalid recommendation canonical tag id.");
  return normalizedCatalog.canonicalTags.find((tag) => tag.id === normalizedTagId) ?? null;
}

function canonicalTagSpecificity(tag: RecommendationCanonicalTag, topicMap: ReadonlyMap<string, RecommendationCatalogTopic>): number {
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

export function resolveRecommendationCanonicalTagForHashtag(
  catalog: RecommendationCatalog,
  hashtag: string
): RecommendationCanonicalTag | null {
  const normalizedCatalog = normalizeRecommendationCatalog(catalog);
  const normalizedHashtag = normalizeHashtagValue(hashtag);
  const topicMap = new Map(normalizedCatalog.topics.map((topic) => [topic.id, topic]));
  let bestMatch: RecommendationCanonicalTag | null = null;
  let bestSpecificity = -1;

  for (const tag of normalizedCatalog.canonicalTags) {
    if (tag.hashtags.includes(normalizedHashtag) || tag.variants.includes(normalizedHashtag)) {
      const specificity = canonicalTagSpecificity(tag, topicMap);
      if (bestMatch === null || specificity > bestSpecificity) {
        bestMatch = tag;
        bestSpecificity = specificity;
      }
    }
  }

  return bestMatch;
}

function expandedCanonicalTagsForTopics(catalog: RecommendationCatalog, selectedTopicIds: readonly string[]): readonly string[] {
  const topicMap = new Map(catalog.topics.map((topic) => [topic.id, topic]));
  const expanded = new Set<string>();
  const queue = [...selectedTopicIds];
  const visited = new Set<string>();

  for (let index = 0; index < queue.length; index += 1) {
    const topicId = queue[index];
    if (topicId === undefined || visited.has(topicId)) {
      continue;
    }
    visited.add(topicId);
    const topic = topicMap.get(topicId);
    if (topic === undefined) {
      throw new TypeError("Recommendation onboarding selection references unknown topic.");
    }
    for (const tagId of topic.canonicalTagIds ?? []) {
      expanded.add(tagId);
    }
    for (const subtopicId of topic.subtopicIds ?? []) {
      queue.push(subtopicId);
    }
  }

  return Object.freeze([...expanded].sort());
}

export function createRecommendationOnboardingSelection(
  input: RecommendationOnboardingSelectionInput
): RecommendationOnboardingSelectionRecord {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation onboarding selection input.");
  }

  const catalog = normalizeRecommendationCatalog(input.catalog);
  const selectedTopicIds = normalizeRequiredStringArray(input.selectedTopicIds, (item) => normalizeCatalogId(item, "Invalid recommendation onboarding topic id."), "Invalid recommendation onboarding topic ids.");
  const selectedCanonicalTagIds = normalizeRequiredStringArray(input.selectedCanonicalTagIds ?? [], (item) => normalizeCatalogId(item, "Invalid recommendation onboarding canonical tag id."), "Invalid recommendation onboarding canonical tag ids.", false);
  const tagIds = new Set(catalog.canonicalTags.map((tag) => tag.id));
  for (const tagId of selectedCanonicalTagIds) {
    if (!tagIds.has(tagId)) {
      throw new TypeError("Recommendation onboarding selection references unknown canonical tag.");
    }
  }

  const expandedCanonicalTagIds = new Set<string>(expandedCanonicalTagsForTopics(catalog, selectedTopicIds));
  for (const tagId of selectedCanonicalTagIds) {
    expandedCanonicalTagIds.add(tagId);
  }

  const storageTarget = input.storageTarget ?? "local_app";
  if (!STORAGE_TARGET_SET.has(storageTarget)) {
    throw new TypeError("Invalid recommendation preference storage target.");
  }

  return Object.freeze({
    schemaVersion: RECOMMENDATION_ONBOARDING_SELECTION_SCHEMA_VERSION,
    selectedTopicIds,
    selectedCanonicalTagIds,
    expandedCanonicalTagIds: Object.freeze([...expandedCanonicalTagIds].sort()),
    allowAutoFollowHashtags: input.allowAutoFollowHashtags === true,
    selectedAt: assertTimestamp(input.selectedAt),
    storageTarget
  });
}

export function createRecommendationHashtagFollowPlan(
  input: RecommendationHashtagFollowPlanInput
): RecommendationHashtagFollowPlan {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation hashtag follow plan input.");
  }

  const catalog = normalizeRecommendationCatalog(input.catalog);
  const selection = createRecommendationOnboardingSelection({
    catalog,
    selectedTopicIds: input.selection.selectedTopicIds,
    selectedCanonicalTagIds: input.selection.selectedCanonicalTagIds,
    allowAutoFollowHashtags: input.selection.allowAutoFollowHashtags,
    selectedAt: input.selection.selectedAt,
    storageTarget: input.selection.storageTarget
  });

  if (!selection.allowAutoFollowHashtags) {
    return Object.freeze({
      schemaVersion: RECOMMENDATION_HASHTAG_FOLLOW_PLAN_SCHEMA_VERSION,
      allowAutoFollowHashtags: false,
      hashtags: Object.freeze([]),
      canonicalTagIds: Object.freeze([]),
      requiresAccountFollowAction: false
    });
  }

  const tagMap = new Map(catalog.canonicalTags.map((tag) => [tag.id, tag]));
  const hashtags = new Set<string>();
  for (const tagId of selection.expandedCanonicalTagIds) {
    const tag = tagMap.get(tagId);
    if (tag === undefined) {
      throw new TypeError("Recommendation hashtag follow plan references unknown canonical tag.");
    }
    for (const hashtag of tag.hashtags) {
      hashtags.add(hashtag);
    }
  }

  return Object.freeze({
    schemaVersion: RECOMMENDATION_HASHTAG_FOLLOW_PLAN_SCHEMA_VERSION,
    allowAutoFollowHashtags: true,
    hashtags: Object.freeze([...hashtags].sort()),
    canonicalTagIds: selection.expandedCanonicalTagIds,
    requiresAccountFollowAction: true
  });
}
