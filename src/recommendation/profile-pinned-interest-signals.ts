import { hasUnsafeControlCharacter } from "./control-characters.js";

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
  discoverable: boolean;
  indexable: boolean;
  blocked: boolean;
  muted: boolean;
  domainBlocked: boolean;
  profileTags?: readonly string[];
  featuredTags?: readonly string[];
}

const MAX_TEXT = 16_384;
const MAX_KEYWORDS = 256;
const MAX_PINNED_POSTS = 10;
const OPT_OUT_PATTERNS = [
  /(?:^|\b)no\s*ai(?:\b|$)/iu,
  /(?:^|\b)no\s*bot(?:s)?(?:\b|$)/iu,
  /(?:^|\b)do\s+not\s+(?:use|index|scrape|recommend|train)(?:\b|$)/iu,
  /(?:^|\b)don['’]?t\s+(?:use|index|scrape|recommend|train)(?:\b|$)/iu,
  /(?:^|\b)not\s+for\s+(?:ai|bots?|training|recommendations?)(?:\b|$)/iu,
  /(?:^|\b)no\s+(?:indexing|scraping|recommendations?|training)(?:\b|$)/iu
] as const;
const OPT_OUT_TAGS = new Set(["noai", "nobot", "noindex", "noarchive", "norecommendation", "norecommendations"]);

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

function hasPlainTextOptOut(text: string): boolean {
  const normalized = plainText(text);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasTagOptOut(policy: RecommendationProfilePinnedAccountPolicy): boolean {
  for (const raw of [...(policy.profileTags ?? []), ...(policy.featuredTags ?? [])]) {
    if (typeof raw !== "string") return true;
    if (OPT_OUT_TAGS.has(canonicalKeyword(raw).replace(/[_-]/gu, ""))) return true;
  }
  return false;
}

function assertAllowed(policy: RecommendationProfilePinnedAccountPolicy, allText: readonly string[]): void {
  if (
    policy.accountEligible !== true ||
    policy.providerAllowsRecommendation !== true ||
    policy.discoverable !== true ||
    policy.indexable !== true ||
    policy.blocked !== false ||
    policy.muted !== false ||
    policy.domainBlocked !== false ||
    hasTagOptOut(policy) ||
    allText.some(hasPlainTextOptOut)
  ) {
    throw new TypeError("Account is not eligible for profile or pinned-post recommendation signals.");
  }
}

function keywordMatches(text: string, keywords: readonly string[]): readonly string[] {
  const normalized = plainText(text).toLocaleLowerCase("und");
  const matches = new Set<string>();
  for (const raw of keywords) {
    if (typeof raw !== "string") throw new TypeError("Invalid profile interest keyword.");
    const keyword = canonicalKeyword(raw);
    if (keyword.length < 2 || keyword.length > 80 || hasUnsafeControlCharacter(keyword)) throw new TypeError("Invalid profile interest keyword.");
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
    if (new RegExp(`(^|[^\\p{Letter}\\p{Number}_])${escaped}($|[^\\p{Letter}\\p{Number}_])`, "iu").test(normalized)) matches.add(keyword);
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
  if (!record(input.profile) || !Array.isArray(input.keywords) || input.keywords.length > MAX_KEYWORDS) {
    throw new TypeError("Invalid profile interest input.");
  }
  const accountId = requiredText(input.accountId, "account ID", 512);
  const accountUri = requiredText(input.accountUri, "account URI");
  const observedAt = instant(input.observedAt);
  const bio = input.protocol === "activitypub"
    ? `${boundedText(input.profile.note ?? input.profile.summary ?? "", "bio")} ${boundedText(input.profile.display_name ?? input.profile.name ?? "", "display name")}`.trim()
    : `${boundedText(input.profile.description ?? "", "bio")} ${boundedText(input.profile.displayName ?? "", "display name")}`.trim();
  const pinned = input.protocol === "activitypub"
    ? mastodonPinnedPosts(input.pinnedPosts ?? [])
    : atprotoPinnedPost(input.profile, input.pinnedPosts);
  assertAllowed(input.policy, [bio, ...pinned.map((item) => item.text)]);

  const output: RecommendationProfilePinnedInterestEvidence[] = [];
  for (const keyword of keywordMatches(bio, input.keywords)) {
    output.push(Object.freeze({ protocol: input.protocol, kind: "bio_keyword", accountId, accountUri, keyword, sourceText: plainText(bio), sourceUri: accountUri, observedAt, confidence: 0.68 }));
  }
  for (const item of pinned) {
    for (const keyword of keywordMatches(item.text, input.keywords)) {
      output.push(Object.freeze({ protocol: input.protocol, kind: "pinned_post_keyword", accountId, accountUri, keyword, sourceText: plainText(item.text), sourceUri: item.uri, observedAt, confidence: 0.82 }));
    }
  }
  return Object.freeze(output);
}
