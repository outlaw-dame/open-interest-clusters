import { hasUnsafeControlCharacter } from "./control-characters.js";

export type RecommendationAccountTopicProtocol = "activitypub" | "atproto";
export type RecommendationPinnedContentCapability = "none" | "single" | "multiple";

export interface RecommendationAccountTopicCapabilities {
  profileText: boolean;
  featuredTopics: boolean;
  pinnedContent: RecommendationPinnedContentCapability;
  structuredOptOutTags: boolean;
  plainTextOptOutScanning: boolean;
}

export interface RecommendationNormalizedPinnedContent {
  uri: string;
  text: string;
  createdAt?: string;
}

export interface RecommendationNormalizedAccountTopicSource {
  provider: string;
  protocol: RecommendationAccountTopicProtocol;
  capabilities: RecommendationAccountTopicCapabilities;
  accountId: string;
  accountUri: string;
  profileText: string;
  displayName?: string;
  featuredTopics: readonly string[];
  structuredTags: readonly string[];
  pinnedContent: readonly RecommendationNormalizedPinnedContent[];
  observedAt: string;
}

const MAX_TEXT = 16_384;
const MAX_ITEMS = 100;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, max = 2_048): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid account topic ${label}.`);
  }
  return value;
}

function optionalText(value: unknown, label: string, max = MAX_TEXT): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || hasUnsafeControlCharacter(value)) throw new TypeError(`Invalid account topic ${label}.`);
  return value;
}

function instant(value: unknown): string {
  const result = requiredText(value, "observation timestamp", 128);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new TypeError("Invalid account topic observation timestamp.");
  }
  return result;
}

function strings(value: unknown, label: string): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError(`Invalid account topic ${label}.`);
  const output = new Set<string>();
  for (const item of value) {
    const raw = record(item) ? item.name ?? item.tag : item;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 80 || hasUnsafeControlCharacter(raw)) throw new TypeError(`Invalid account topic ${label}.`);
    output.add(raw.normalize("NFKC").replace(/^#/u, "").toLocaleLowerCase("und"));
  }
  return Object.freeze([...output]);
}

function pinned(items: unknown, mode: RecommendationPinnedContentCapability): readonly RecommendationNormalizedPinnedContent[] {
  if (items === undefined || items === null) return Object.freeze([]);
  const values = Array.isArray(items) ? items : [items];
  const maximum = mode === "none" ? 0 : mode === "single" ? 1 : 10;
  if (values.length > maximum) throw new TypeError("Invalid account topic pinned content.");
  return Object.freeze(values.map((item) => {
    if (!record(item)) throw new TypeError("Invalid account topic pinned content.");
    const result: RecommendationNormalizedPinnedContent = {
      uri: requiredText(item.uri ?? item.url ?? item.id, "pinned content URI"),
      text: optionalText(item.text ?? item.content, "pinned content text") ?? ""
    };
    const createdAt = optionalText(item.createdAt ?? item.created_at ?? item.published, "pinned content timestamp", 128);
    if (createdAt !== undefined) result.createdAt = instant(createdAt);
    return Object.freeze(result);
  }));
}

function capabilities(input: RecommendationAccountTopicCapabilities): RecommendationAccountTopicCapabilities {
  if (!record(input) || typeof input.profileText !== "boolean" || typeof input.featuredTopics !== "boolean" || !["none", "single", "multiple"].includes(input.pinnedContent) || typeof input.structuredOptOutTags !== "boolean" || typeof input.plainTextOptOutScanning !== "boolean") {
    throw new TypeError("Invalid account topic capabilities.");
  }
  return Object.freeze({ ...input });
}

function freeze(input: RecommendationNormalizedAccountTopicSource): RecommendationNormalizedAccountTopicSource {
  return Object.freeze({
    ...input,
    capabilities: capabilities(input.capabilities),
    featuredTopics: Object.freeze([...input.featuredTopics]),
    structuredTags: Object.freeze([...input.structuredTags]),
    pinnedContent: Object.freeze([...input.pinnedContent])
  });
}

export function normalizeRecommendationMastodonAccountTopicSource(input: {
  provider?: string;
  account: unknown;
  featuredTags?: unknown;
  pinnedStatuses?: unknown;
  observedAt: string;
}): RecommendationNormalizedAccountTopicSource {
  if (!record(input.account)) throw new TypeError("Invalid Mastodon account topic source.");
  const account = input.account;
  const accountId = requiredText(account.id, "account ID", 512);
  const accountUri = requiredText(account.uri ?? account.url, "account URI");
  const displayName = optionalText(account.display_name ?? account.name, "display name", 512);
  const pinnedStatuses = Array.isArray(input.pinnedStatuses) ? input.pinnedStatuses.map((status) => {
    if (!record(status) || status.pinned !== true) throw new TypeError("Invalid Mastodon pinned status.");
    return {
      uri: status.uri ?? status.url,
      text: `${optionalText(status.spoiler_text, "pinned warning") ?? ""} ${optionalText(status.content, "pinned content") ?? ""}`.trim(),
      createdAt: status.created_at
    };
  }) : input.pinnedStatuses;
  return freeze({
    provider: input.provider ?? "mastodon_api",
    protocol: "activitypub",
    capabilities: {
      profileText: true,
      featuredTopics: input.featuredTags !== undefined,
      pinnedContent: "multiple",
      structuredOptOutTags: true,
      plainTextOptOutScanning: true
    },
    accountId,
    accountUri,
    profileText: optionalText(account.note ?? account.summary, "profile text") ?? "",
    ...(displayName === undefined ? {} : { displayName }),
    featuredTopics: strings(input.featuredTags, "featured topics"),
    structuredTags: strings(account.tags, "structured tags"),
    pinnedContent: pinned(pinnedStatuses, "multiple"),
    observedAt: instant(input.observedAt)
  });
}

export function normalizeRecommendationActivityPubActorTopicSource(input: {
  provider?: string;
  actor: unknown;
  featuredTags?: unknown;
  featuredItems?: unknown;
  observedAt: string;
}): RecommendationNormalizedAccountTopicSource {
  if (!record(input.actor)) throw new TypeError("Invalid ActivityPub account topic source.");
  const actor = input.actor;
  const displayName = optionalText(actor.name, "display name", 512);
  const featuredItems = record(input.featuredItems) && Array.isArray(input.featuredItems.orderedItems)
    ? input.featuredItems.orderedItems
    : input.featuredItems;
  return freeze({
    provider: input.provider ?? "activitypub_actor",
    protocol: "activitypub",
    capabilities: {
      profileText: true,
      featuredTopics: input.featuredTags !== undefined || actor.featuredTags !== undefined,
      pinnedContent: featuredItems === undefined ? "none" : "multiple",
      structuredOptOutTags: true,
      plainTextOptOutScanning: true
    },
    accountId: requiredText(actor.id, "account ID"),
    accountUri: requiredText(actor.id, "account URI"),
    profileText: optionalText(actor.summary, "profile text") ?? "",
    ...(displayName === undefined ? {} : { displayName }),
    featuredTopics: strings(input.featuredTags ?? actor.featuredTags, "featured topics"),
    structuredTags: strings(actor.tag, "structured tags"),
    pinnedContent: pinned(featuredItems, featuredItems === undefined ? "none" : "multiple"),
    observedAt: instant(input.observedAt)
  });
}

export function normalizeRecommendationAtprotoAccountTopicSource(input: {
  provider?: string;
  profile: unknown;
  pinnedPost?: unknown;
  observedAt: string;
}): RecommendationNormalizedAccountTopicSource {
  if (!record(input.profile)) throw new TypeError("Invalid ATProto account topic source.");
  const profile = input.profile;
  const did = requiredText(profile.did, "account DID", 512);
  const displayName = optionalText(profile.displayName, "display name", 512);
  let pinnedPost: unknown = undefined;
  if (profile.pinnedPost !== undefined && profile.pinnedPost !== null) {
    if (!record(profile.pinnedPost) || typeof profile.pinnedPost.uri !== "string" || typeof profile.pinnedPost.cid !== "string") throw new TypeError("Invalid ATProto pinned-post reference.");
    if (!record(input.pinnedPost) || input.pinnedPost.uri !== profile.pinnedPost.uri || input.pinnedPost.cid !== profile.pinnedPost.cid || !record(input.pinnedPost.record)) {
      throw new TypeError("ATProto pinned post does not match the profile strong reference.");
    }
    pinnedPost = {
      uri: input.pinnedPost.uri,
      text: input.pinnedPost.record.text,
      createdAt: input.pinnedPost.record.createdAt
    };
  }
  return freeze({
    provider: input.provider ?? "atproto_appview",
    protocol: "atproto",
    capabilities: {
      profileText: true,
      featuredTopics: false,
      pinnedContent: "single",
      structuredOptOutTags: false,
      plainTextOptOutScanning: true
    },
    accountId: did,
    accountUri: did,
    profileText: optionalText(profile.description, "profile text") ?? "",
    ...(displayName === undefined ? {} : { displayName }),
    featuredTopics: Object.freeze([]),
    structuredTags: Object.freeze([]),
    pinnedContent: pinned(pinnedPost, "single"),
    observedAt: instant(input.observedAt)
  });
}
