import { RECOMMENDATION_ACCESS_BASES, RECOMMENDATION_SOURCE_VISIBILITIES } from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_MASTODON_HASHTAG_SIGNAL_KINDS = [
  "account_featured",
  "viewer_followed",
  "viewer_featured",
  "instance_trending"
] as const;
export type RecommendationMastodonHashtagSignalKind = typeof RECOMMENDATION_MASTODON_HASHTAG_SIGNAL_KINDS[number];

export interface RecommendationMastodonHashtagEvidence {
  kind: RecommendationMastodonHashtagSignalKind;
  tag: string;
  sourceUrl: string;
  observedAt: string;
  accountId?: string;
  featuredTagId?: string;
  statusesCount?: number;
  lastStatusAt?: string;
  historyUses: number;
  historyAccounts: number;
  confidence: number;
  viewerSpecific: boolean;
}

export interface RecommendationMastodonHashtagTransport {
  get(input: { url: string; requiresAuthentication: boolean; signal?: AbortSignal }):
    | { body: unknown; observedAt: string }
    | Promise<{ body: unknown; observedAt: string }>;
}

const MAX_TAGS = 200;
const MAX_TEXT = 2_048;
const MAX_COUNT = 1_000_000_000;
const MAX_HISTORY_DAYS = 14;
const DAY_SECONDS = 86_400;
const SOURCE_VISIBILITIES = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASES = new Set<string>(RECOMMENDATION_ACCESS_BASES);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid Mastodon hashtag ${label}.`);
  }
  return value;
}

function instant(value: unknown, label: string): string {
  const result = text(value, label, 128);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "mastodon-hashtag", since: result });
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`Invalid Mastodon hashtag ${label}.`);
  return result;
}

function count(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_COUNT) throw new TypeError(`Invalid Mastodon hashtag ${label}.`);
  return parsed;
}

function tag(value: unknown): string {
  const normalized = text(value, "name", 80).replace(/^#/u, "").normalize("NFKC").toLocaleLowerCase("und");
  if (normalized.length === 0 || /^\d+$/u.test(normalized) || !/^[\p{Letter}\p{Number}_]+$/u.test(normalized)) throw new TypeError("Invalid Mastodon hashtag name.");
  return normalized;
}

function safeBaseUrl(value: unknown): URL {
  let url: URL;
  try { url = new URL(text(value, "base URL")); } catch { throw new TypeError("Invalid Mastodon hashtag base URL."); }
  const host = url.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")) throw new TypeError("Invalid Mastodon hashtag base URL.");
  url.hostname = host;
  url.pathname = "/";
  return url;
}

function authorize(value: unknown, subjectId: string, viewerSpecific: boolean): void {
  if (!record(value) || value.status !== "authorized" || value.subjectId !== subjectId) throw new TypeError("Invalid Mastodon hashtag authorization.");
  instant(value.checkedAt, "authorization timestamp");
  if (typeof value.sourceVisibility !== "string" || !SOURCE_VISIBILITIES.has(value.sourceVisibility) || typeof value.accessBasis !== "string" || !ACCESS_BASES.has(value.accessBasis)) throw new TypeError("Invalid Mastodon hashtag authorization.");
  if (viewerSpecific) {
    if ((value.accessBasis !== "oauth_scope" && value.accessBasis !== "authenticated_api") || value.containsPrivateData !== true || value.sourceVisibility === "public") {
      throw new TypeError("Mastodon hashtag source requires explicit private-data authorization evidence.");
    }
  } else if (value.accessBasis === "unknown") {
    throw new TypeError("Mastodon hashtag source requires public-read authorization evidence.");
  }
}

function history(value: unknown, observedAt: string): { uses: number; accounts: number } {
  if (value === undefined) return { uses: 0, accounts: 0 };
  if (!Array.isArray(value) || value.length > MAX_HISTORY_DAYS) throw new TypeError("Invalid Mastodon hashtag history.");
  const observedSeconds = Math.floor(Date.parse(observedAt) / 1000);
  const latestAllowedDay = Math.floor(observedSeconds / DAY_SECONDS) * DAY_SECONDS;
  const earliestAllowedDay = latestAllowedDay - (MAX_HISTORY_DAYS - 1) * DAY_SECONDS;
  const days = new Set<number>();
  let uses = 0;
  let accounts = 0;
  for (const item of value) {
    if (!record(item)) throw new TypeError("Invalid Mastodon hashtag history.");
    const day = count(item.day, "history day");
    if (day % DAY_SECONDS !== 0 || day < earliestAllowedDay || day > latestAllowedDay || days.has(day)) {
      throw new TypeError("Invalid Mastodon hashtag history day.");
    }
    days.add(day);
    uses += count(item.uses, "history uses");
    accounts += count(item.accounts, "history accounts");
    if (uses > MAX_COUNT || accounts > MAX_COUNT) throw new TypeError("Invalid Mastodon hashtag history.");
  }
  return { uses, accounts };
}

function parseItems(input: { body: unknown; kind: RecommendationMastodonHashtagSignalKind; observedAt: string; baseUrl: URL; responseLimit: number; accountId?: string }): readonly RecommendationMastodonHashtagEvidence[] {
  if (!Array.isArray(input.body) || input.body.length > input.responseLimit) throw new TypeError("Invalid Mastodon hashtag response.");
  return Object.freeze(input.body.map((raw): RecommendationMastodonHashtagEvidence => {
    if (!record(raw)) throw new TypeError("Invalid Mastodon hashtag response.");
    const normalizedTag = tag(raw.name);
    const aggregate = history(raw.history, input.observedAt);
    const featured = input.kind === "account_featured" || input.kind === "viewer_featured";
    const sourceUrl = typeof raw.url === "string" ? new URL(raw.url, input.baseUrl) : new URL(`/tags/${encodeURIComponent(normalizedTag)}`, input.baseUrl);
    if (sourceUrl.protocol !== "https:" || sourceUrl.username !== "" || sourceUrl.password !== "") throw new TypeError("Invalid Mastodon hashtag source URL.");
    const result: RecommendationMastodonHashtagEvidence = {
      kind: input.kind,
      tag: normalizedTag,
      sourceUrl: sourceUrl.toString(),
      observedAt: input.observedAt,
      historyUses: aggregate.uses,
      historyAccounts: aggregate.accounts,
      confidence: featured ? 0.95 : input.kind === "viewer_followed" ? 0.9 : 0.35,
      viewerSpecific: input.kind === "viewer_followed" || input.kind === "viewer_featured"
    };
    if (input.accountId !== undefined) result.accountId = input.accountId;
    if (raw.id !== undefined) result.featuredTagId = text(raw.id, "ID", 512);
    if (raw.statuses_count !== undefined) result.statusesCount = count(raw.statuses_count, "statuses count");
    if (raw.last_status_at !== undefined && raw.last_status_at !== null) result.lastStatusAt = instant(raw.last_status_at, "last status timestamp");
    return Object.freeze(result);
  }));
}

function client(input: { baseUrl: string; path: string; viewerSpecific: boolean; responseLimit: number; kind: RecommendationMastodonHashtagSignalKind; transport: RecommendationMastodonHashtagTransport; accountId?: string }) {
  const baseUrl = safeBaseUrl(input.baseUrl);
  if (!Number.isSafeInteger(input.responseLimit) || input.responseLimit < 1 || input.responseLimit > MAX_TAGS) throw new TypeError("Invalid Mastodon hashtag response limit.");
  if (!record(input.transport) || typeof input.transport.get !== "function") throw new TypeError("Invalid Mastodon hashtag transport.");
  const url = new URL(input.path, baseUrl);
  return Object.freeze({
    async read(readInput: { subjectId: string; authorization: RecommendationProtocolSourceReadAuthorization; signal?: AbortSignal }) {
      if (!record(readInput)) throw new TypeError("Invalid Mastodon hashtag read input.");
      const subjectId = text(readInput.subjectId, "subject ID", 512);
      authorize(readInput.authorization, subjectId, input.viewerSpecific);
      const response = await input.transport.get({ url: url.toString(), requiresAuthentication: input.viewerSpecific, ...(readInput.signal === undefined ? {} : { signal: readInput.signal }) });
      if (!record(response)) throw new TypeError("Invalid Mastodon hashtag transport response.");
      const observedAt = instant(response.observedAt, "observation timestamp");
      return parseItems({ body: response.body, kind: input.kind, observedAt, baseUrl, responseLimit: input.responseLimit, ...(input.accountId === undefined ? {} : { accountId: input.accountId }) });
    }
  });
}

export function createRecommendationMastodonAccountFeaturedTagsClient(input: { baseUrl: string; accountId: string; transport: RecommendationMastodonHashtagTransport }) {
  const accountId = text(input.accountId, "account ID", 512);
  return client({ ...input, accountId, path: `/api/v1/accounts/${encodeURIComponent(accountId)}/featured_tags`, viewerSpecific: false, responseLimit: MAX_TAGS, kind: "account_featured" });
}

export function createRecommendationMastodonViewerFeaturedTagsClient(input: { baseUrl: string; transport: RecommendationMastodonHashtagTransport }) {
  return client({ ...input, path: "/api/v1/featured_tags", viewerSpecific: true, responseLimit: MAX_TAGS, kind: "viewer_featured" });
}

export function createRecommendationMastodonFollowedTagsClient(input: { baseUrl: string; transport: RecommendationMastodonHashtagTransport; limit?: number }) {
  const limit = input.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("Invalid Mastodon followed-tags limit.");
  return client({ ...input, path: `/api/v1/followed_tags?limit=${limit}`, viewerSpecific: true, responseLimit: limit, kind: "viewer_followed" });
}

export function createRecommendationMastodonTrendingTagsClient(input: { baseUrl: string; transport: RecommendationMastodonHashtagTransport; limit?: number }) {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new TypeError("Invalid Mastodon trending-tags limit.");
  return client({ ...input, path: `/api/v1/trends/tags?limit=${limit}`, viewerSpecific: false, responseLimit: limit, kind: "instance_trending" });
}
