import { hashtagPhraseVariants, normalizeHashtag } from "../normalization/hashtags.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  normalizeRecommendationProfileFeatureCapabilities,
  type RecommendationProfileFeatureCapabilities,
  type RecommendationProfileFeatureSupport
} from "./profile-feature-capabilities.js";

export const RECOMMENDATION_PROFILE_PINNED_SIGNAL_KINDS = ["bio_keyword", "pinned_post_keyword"] as const;
export type RecommendationProfilePinnedSignalKind = typeof RECOMMENDATION_PROFILE_PINNED_SIGNAL_KINDS[number];
export type RecommendationProfilePinnedProtocol = "activitypub" | "atproto";

export interface RecommendationProfilePinnedInterestEvidence {
  protocol: RecommendationProfilePinnedProtocol;
  kind: RecommendationProfilePinnedSignalKind;
  accountId: string;
  accountUri: string;
  keyword: string;
  sourceText: string;
  sourceUri: string;
  observedAt: string;
  confidence: number;
}

export interface RecommendationProfilePinnedAccountPolicy {
  accountEligible: boolean;
  providerAllowsRecommendation: boolean;
  blocked: boolean;
  muted: boolean;
  domainBlocked: boolean;
  capabilities: RecommendationProfileFeatureCapabilities;
  discoverable?: boolean | null;
  indexable?: boolean | null;
  noindex?: boolean | null;
  featuredTags?: readonly string[];
}

const MAX_TEXT = 16_384;
const MAX_KEYWORDS = 256;
const MAX_PINNED_POSTS = 10;
const MAX_FEATURED_TAGS = 256;
const MAX_EXTRACTED_HASHTAGS = 128;
const HASHTAG_TOKEN_PATTERN = /#([\p{Letter}\p{Mark}\p{Number}_\-\u2010-\u2015]{2,160})/gu;
const POLICY_KEYS = new Set([
  "accountEligible",
  "providerAllowsRecommendation",
  "blocked",
  "muted",
  "domainBlocked",
  "capabilities",
  "discoverable",
  "indexable",
  "noindex",
  "featuredTags"
]);
const OPT_OUT_PATTERNS = [
  /(?:^|\b)no\s*ai(?:\b|$)/iu,
  /(?:^|\b)no\s*bot(?:s)?(?:\b|$)/iu,
  /(?:^|\b)do\s+not\s+(?:use|index|scrape|recommend|train)(?:\b|$)/iu,
  /(?:^|\b)don['’]?t\s+(?:use|index|scrape|recommend|train)(?:\b|$)/iu,
  /(?:^|\b)not\s+for\s+(?:ai|bots?|training|recommendations?)(?:\b|$)/iu,
  /(?:^|\b)no\s+(?:indexing|scraping|recommendations?|training)(?:\b|$)/iu
] as const;
const OPT_OUT_TAGS = new Set([
  "noai",
  "nobot",
  "nobots",
  "noindex",
  "noindexing",
  "noarchive",
  "noscrape",
  "noscraping",
  "norecommendation",
  "norecommendations",
  "notraining"
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > MAX_TEXT || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid profile interest ${label}.`);
  }
  return value;
}

function requiredText(value: unknown, label: string, max = 2_048): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid profile interest ${label}.`);
  }
  return value;
}

function instant(value: unknown): string {
  const result = requiredText(value, "observation timestamp", 128);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new TypeError("Invalid profile interest observation timestamp.");
  }
  return result;
}

function plainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, " ")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalKeyword(value: string): string {
  return value.normalize("NFKC").trim().replace(/^#/u, "").toLocaleLowerCase("und");
}

function canonicalOptOutToken(value: string): string {
  return normalizeHashtag(value).replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function hasInlineOptOutToken(text: string): boolean {
  const normalized = plainText(text);
  const tokenPattern = /(?:^|[^\p{Letter}\p{Number}_])#?([\p{Letter}\p{Number}_-]{2,80})(?=$|[^\p{Letter}\p{Number}_])/gu;
  for (const match of normalized.matchAll(tokenPattern)) {
    const raw = match[1];
    if (raw !== undefined && OPT_OUT_TAGS.has(canonicalOptOutToken(raw))) return true;
  }
  return false;
}

function hasPlainTextOptOut(text: string): boolean {
  const normalized = plainText(text);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized)) || hasInlineOptOutToken(normalized);
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`Invalid profile interest ${label}.`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return booleanField(value, label);
}

function featuredTags(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_FEATURED_TAGS || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError("Invalid profile interest featured tags.");
  }
  return Object.freeze(value.map((entry) => requiredText(entry, "featured tag", 256)));
}

function normalizePolicy(
  value: unknown,
  protocol: RecommendationProfilePinnedProtocol
): RecommendationProfilePinnedAccountPolicy {
  if (!record(value) || Object.keys(value).some((key) => !POLICY_KEYS.has(key))) {
    throw new TypeError("Invalid profile interest account policy.");
  }
  const capabilities = normalizeRecommendationProfileFeatureCapabilities(value.capabilities);
  if (capabilities.protocol !== protocol) {
    throw new TypeError("Profile feature capabilities do not match the recommendation protocol.");
  }
  const discoverable = optionalBoolean(value.discoverable, "discoverability state");
  const indexable = optionalBoolean(value.indexable, "indexability state");
  const noindex = optionalBoolean(value.noindex, "noindex state");
  const normalized: RecommendationProfilePinnedAccountPolicy = {
    accountEligible: booleanField(value.accountEligible, "account eligibility"),
    providerAllowsRecommendation: booleanField(value.providerAllowsRecommendation, "provider policy"),
    blocked: booleanField(value.blocked, "blocked state"),
    muted: booleanField(value.muted, "muted state"),
    domainBlocked: booleanField(value.domainBlocked, "domain-blocked state"),
    capabilities,
    featuredTags: featuredTags(value.featuredTags)
  };
  if (discoverable !== undefined) normalized.discoverable = discoverable;
  if (indexable !== undefined) normalized.indexable = indexable;
  if (noindex !== undefined) normalized.noindex = noindex;
  return Object.freeze(normalized);
}

function supportedPositiveControl(
  support: RecommendationProfileFeatureSupport,
  value: boolean | undefined
): boolean {
  switch (support) {
    case "supported": return value === true;
    case "unsupported": return value === undefined;
    case "unknown": return false;
  }
}

function supportedNoindexControl(
  support: RecommendationProfileFeatureSupport,
  value: boolean | undefined
): boolean {
  switch (support) {
    case "supported": return value !== true;
    case "unsupported": return value === undefined;
    case "unknown": return false;
  }
}

function hasFeaturedTagOptOut(policy: RecommendationProfilePinnedAccountPolicy): boolean {
  for (const raw of policy.featuredTags ?? []) {
    if (OPT_OUT_TAGS.has(canonicalOptOutToken(raw))) return true;
  }
  return false;
}

function profileTextPresent(
  protocol: RecommendationProfilePinnedProtocol,
  profile: Record<string, unknown>
): boolean {
  const fields = protocol === "activitypub"
    ? [profile.note, profile.summary, profile.display_name, profile.name]
    : [profile.description, profile.displayName];
  return fields.some((value) => value !== undefined && value !== null && value !== "");
}

function readProfileText(
  protocol: RecommendationProfilePinnedProtocol,
  profile: Record<string, unknown>
): string {
  return protocol === "activitypub"
    ? `${boundedText(profile.note ?? profile.summary ?? "", "bio")} ${boundedText(profile.display_name ?? profile.name ?? "", "display name")}`.trim()
    : `${boundedText(profile.description ?? "", "bio")} ${boundedText(profile.displayName ?? "", "display name")}`.trim();
}

function hasAnyPinnedInput(
  protocol: RecommendationProfilePinnedProtocol,
  profile: Record<string, unknown>,
  pinnedPosts: unknown
): boolean {
  if (protocol === "atproto") return profile.pinnedPost !== undefined && profile.pinnedPost !== null;
  return Array.isArray(pinnedPosts) && pinnedPosts.length > 0;
}

function assertCapabilitiesAndPolicy(
  policy: RecommendationProfilePinnedAccountPolicy,
  protocol: RecommendationProfilePinnedProtocol,
  profile: Record<string, unknown>,
  pinnedPosts: unknown,
  allText: readonly string[]
): void {
  const capabilities = policy.capabilities;
  const pinnedPresent = hasAnyPinnedInput(protocol, profile, pinnedPosts);
  const profileTextExists = profileTextPresent(protocol, profile);
  const featured = policy.featuredTags ?? [];

  const profileTextCapabilityValid = capabilities.rawProfileText === "supported"
    ? true
    : capabilities.rawProfileText === "unsupported"
      ? !profileTextExists
      : false;
  const featuredCapabilityValid = capabilities.featuredHashtags === "supported"
    ? true
    : capabilities.featuredHashtags === "unsupported"
      ? featured.length === 0
      : false;
  const pinnedCapabilityValid = capabilities.pinnedPosts === "supported"
    ? true
    : capabilities.pinnedPosts === "unsupported"
      ? !pinnedPresent
      : false;

  if (
    policy.accountEligible !== true ||
    policy.providerAllowsRecommendation !== true ||
    policy.blocked !== false ||
    policy.muted !== false ||
    policy.domainBlocked !== false ||
    !profileTextCapabilityValid ||
    !supportedPositiveControl(capabilities.discoverabilityControl, policy.discoverable ?? undefined) ||
    !supportedPositiveControl(capabilities.indexabilityControl, policy.indexable ?? undefined) ||
    !supportedNoindexControl(capabilities.noindexSignal, policy.noindex ?? undefined) ||
    !featuredCapabilityValid ||
    !pinnedCapabilityValid ||
    hasFeaturedTagOptOut(policy) ||
    allText.some(hasPlainTextOptOut)
  ) {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
}

function profileHashtagPhraseVariants(text: string): ReadonlySet<string> {
  const variants = new Set<string>();
  const normalized = plainText(text);
  let count = 0;
  for (const match of normalized.matchAll(HASHTAG_TOKEN_PATTERN)) {
    const token = match[1];
    if (token === undefined) continue;
    for (const variant of hashtagPhraseVariants(token)) {
      variants.add(variant);
    }
    count += 1;
    if (count >= MAX_EXTRACTED_HASHTAGS) break;
  }
  return variants;
}

function keywordMatches(text: string, keywords: readonly string[]): readonly string[] {
  const plain = plainText(text);
  const normalized = plain.toLocaleLowerCase("und");
  const hashtagVariants = profileHashtagPhraseVariants(plain);
  const matches = new Set<string>();
  for (const raw of keywords) {
    if (typeof raw !== "string") throw new TypeError("Invalid profile interest keyword.");
    const keyword = canonicalKeyword(raw);
    if (keyword.length < 2 || keyword.length > 80 || hasUnsafeControlCharacter(keyword)) throw new TypeError("Invalid profile interest keyword.");
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
    const directMatch = new RegExp(`(^|[^\\p{Letter}\\p{Number}_])${escaped}($|[^\\p{Letter}\\p{Number}_])`, "iu").test(normalized);
    if (directMatch || hashtagVariants.has(keyword)) matches.add(keyword);
    if (matches.size >= MAX_KEYWORDS) break;
  }
  return Object.freeze([...matches]);
}

function mastodonPinnedPosts(value: unknown): readonly { uri: string; text: string }[] {
  if (!Array.isArray(value) || value.length > MAX_PINNED_POSTS) throw new TypeError("Invalid Mastodon pinned posts.");
  return Object.freeze(value.map((item) => {
    if (!record(item) || item.pinned !== true) throw new TypeError("Invalid Mastodon pinned post.");
    return Object.freeze({
      uri: requiredText(item.uri ?? item.url, "pinned-post URI"),
      text: `${boundedText(item.spoiler_text ?? "", "pinned-post warning")} ${boundedText(item.content ?? "", "pinned-post content")}`.trim()
    });
  }));
}

function atprotoPinnedPost(profile: Record<string, unknown>, post: unknown): readonly { uri: string; text: string }[] {
  if (profile.pinnedPost === undefined || profile.pinnedPost === null) return Object.freeze([]);
  if (!record(profile.pinnedPost) || typeof profile.pinnedPost.uri !== "string" || typeof profile.pinnedPost.cid !== "string") {
    throw new TypeError("Invalid ATProto pinned-post reference.");
  }
  if (!record(post) || post.uri !== profile.pinnedPost.uri || post.cid !== profile.pinnedPost.cid || !record(post.record)) {
    throw new TypeError("ATProto pinned post does not match the profile strong reference.");
  }
  return Object.freeze([Object.freeze({
    uri: requiredText(post.uri, "pinned-post URI"),
    text: boundedText(post.record.text, "pinned-post content")
  })]);
}

export function deriveRecommendationProfilePinnedInterestEvidence(input: {
  protocol: RecommendationProfilePinnedProtocol;
  accountId: string;
  accountUri: string;
  profile: unknown;
  pinnedPosts?: unknown;
  keywords: readonly string[];
  policy: RecommendationProfilePinnedAccountPolicy;
  observedAt: string;
}): readonly RecommendationProfilePinnedInterestEvidence[] {
  if (
    !record(input) ||
    (input.protocol !== "activitypub" && input.protocol !== "atproto") ||
    !record(input.profile) ||
    !Array.isArray(input.keywords) ||
    input.keywords.length > MAX_KEYWORDS
  ) {
    throw new TypeError("Invalid profile interest input.");
  }
  const accountId = requiredText(input.accountId, "account ID", 512);
  const accountUri = requiredText(input.accountUri, "account URI");
  const observedAt = instant(input.observedAt);
  const policy = normalizePolicy(input.policy, input.protocol);

  if (policy.capabilities.rawProfileText === "unknown") {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
  if (policy.capabilities.rawProfileText === "unsupported" && profileTextPresent(input.protocol, input.profile)) {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
  const bio = policy.capabilities.rawProfileText === "supported"
    ? readProfileText(input.protocol, input.profile)
    : "";

  const pinnedPresent = hasAnyPinnedInput(input.protocol, input.profile, input.pinnedPosts);
  if (policy.capabilities.pinnedPosts === "unknown") {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
  if (policy.capabilities.pinnedPosts === "unsupported" && pinnedPresent) {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
  const pinned = policy.capabilities.pinnedPosts === "supported"
    ? input.protocol === "activitypub"
      ? mastodonPinnedPosts(input.pinnedPosts ?? [])
      : atprotoPinnedPost(input.profile, input.pinnedPosts)
    : Object.freeze([]);

  assertCapabilitiesAndPolicy(policy, input.protocol, input.profile, input.pinnedPosts, [bio, ...pinned.map((item) => item.text)]);

  const output: RecommendationProfilePinnedInterestEvidence[] = [];
  for (const keyword of keywordMatches(bio, input.keywords)) {
    output.push(Object.freeze({
      protocol: input.protocol,
      kind: "bio_keyword",
      accountId,
      accountUri,
      keyword,
      sourceText: plainText(bio),
      sourceUri: accountUri,
      observedAt,
      confidence: 0.68
    }));
  }
  for (const item of pinned) {
    for (const keyword of keywordMatches(item.text, input.keywords)) {
      output.push(Object.freeze({
        protocol: input.protocol,
        kind: "pinned_post_keyword",
        accountId,
        accountUri,
        keyword,
        sourceText: plainText(item.text),
        sourceUri: item.uri,
        observedAt,
        confidence: 0.82
      }));
    }
  }
  return Object.freeze(output);
}
