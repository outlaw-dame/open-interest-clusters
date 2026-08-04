import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_MASTODON_FILTER_CONTEXTS = ["home", "notifications", "public", "thread", "account"] as const;
export type RecommendationMastodonFilterContext = typeof RECOMMENDATION_MASTODON_FILTER_CONTEXTS[number];

export const RECOMMENDATION_MASTODON_FILTER_ACTIONS = ["warn", "hide", "blur"] as const;
export type RecommendationMastodonFilterAction = typeof RECOMMENDATION_MASTODON_FILTER_ACTIONS[number];

export interface RecommendationMastodonSafetyAccount {
  id: string;
  acct: string;
  domain?: string;
  url?: string;
}

export interface RecommendationMastodonFilterKeyword {
  id: string;
  keyword: string;
  wholeWord: boolean;
}

export interface RecommendationMastodonFilterStatus {
  id: string;
  statusId: string;
}

export interface RecommendationMastodonFilter {
  id: string;
  title: string;
  contexts: readonly RecommendationMastodonFilterContext[];
  expiresAt: string | null;
  action: RecommendationMastodonFilterAction;
  keywords: readonly RecommendationMastodonFilterKeyword[];
  statuses: readonly RecommendationMastodonFilterStatus[];
}

export interface RecommendationMastodonViewerSafetySnapshot {
  subjectId: string;
  observedAt: string;
  blockedAccounts: readonly RecommendationMastodonSafetyAccount[];
  mutedAccounts: readonly RecommendationMastodonSafetyAccount[];
  blockedDomains: readonly string[];
  filters: readonly RecommendationMastodonFilter[];
}

export interface RecommendationMastodonViewerSafetyTransport {
  get(input: { url: string; requiresAuthentication: true; signal?: AbortSignal }):
    | { body: unknown; observedAt: string; nextUrl?: string }
    | Promise<{ body: unknown; observedAt: string; nextUrl?: string }>;
}

export interface RecommendationMastodonViewerSafetyReadInput {
  subjectId: string;
  authorization: RecommendationProtocolSourceReadAuthorization;
  grantedScopes: readonly string[];
  signal?: AbortSignal;
}

export interface RecommendationMastodonViewerSafetyPage<T> {
  items: readonly T[];
  observedAt: string;
  nextUrl?: string;
}

export interface RecommendationMastodonSafetyCandidate {
  accountId?: string;
  accountAcct?: string;
  domain?: string;
  statusId?: string;
  text?: string;
  context: RecommendationMastodonFilterContext;
  hasMedia?: boolean;
}

export interface RecommendationMastodonSafetyDecision {
  eligible: boolean;
  mediaEligible: boolean;
  warningRequired: boolean;
  reasonCodes: readonly string[];
  matchedFilterIds: readonly string[];
}

const MAX_TEXT = 16_384;
const MAX_ITEMS = 1_000;
const MAX_SCOPES = 128;
const FILTER_CONTEXTS = new Set<string>(RECOMMENDATION_MASTODON_FILTER_CONTEXTS);
const FILTER_ACTIONS = new Set<string>(RECOMMENDATION_MASTODON_FILTER_ACTIONS);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid Mastodon safety ${label}.`);
  }
  return value;
}

function instant(value: unknown, label: string): string {
  const normalized = text(value, label, 128);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "mastodon-viewer-safety", since: normalized });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`Invalid Mastodon safety ${label}.`);
  return normalized;
}

function safeBaseUrl(value: unknown): URL {
  let url: URL;
  try { url = new URL(text(value, "base URL", 2_048)); } catch { throw new TypeError("Invalid Mastodon safety base URL."); }
  const host = normalizeDomain(url.hostname);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    throw new TypeError("Invalid Mastodon safety base URL.");
  }
  url.hostname = host;
  url.pathname = "/";
  return url;
}

function normalizeDomain(value: unknown): string {
  const domain = text(value, "domain", 253).normalize("NFKC").toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local") || domain.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(domain) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(domain)) {
    throw new TypeError("Invalid Mastodon safety domain.");
  }
  return domain;
}

function normalizeScopes(value: unknown): Set<string> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPES) throw new TypeError("Invalid Mastodon safety OAuth scopes.");
  const scopes = new Set<string>();
  for (const raw of value) scopes.add(text(raw, "OAuth scope", 128));
  return scopes;
}

function scopeAllows(scopes: Set<string>, required: string): boolean {
  if (scopes.has(required) || scopes.has("read") || scopes.has("read:all")) return true;
  const namespace = required.split(":", 1)[0];
  return scopes.has(namespace);
}

function authorize(value: unknown, subjectId: string, scopesInput: unknown, requiredScope: string): void {
  if (!record(value) || value.status !== "authorized" || value.subjectId !== subjectId) throw new TypeError("Invalid Mastodon safety authorization.");
  instant(value.checkedAt, "authorization timestamp");
  if ((value.accessBasis !== "oauth_scope" && value.accessBasis !== "authenticated_api") || value.containsPrivateData !== true || value.sourceVisibility === "public") {
    throw new TypeError("Mastodon safety source requires explicit private-data authorization evidence.");
  }
  const scopes = normalizeScopes(scopesInput);
  if (!scopeAllows(scopes, requiredScope)) throw new TypeError(`Mastodon safety source requires ${requiredScope} authorization.`);
}

function sameOriginPageUrl(value: unknown, baseUrl: URL, expectedPath: string): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try { url = new URL(text(value, "pagination URL", 4_096)); } catch { throw new TypeError("Invalid Mastodon safety pagination URL."); }
  if (url.protocol !== "https:" || url.origin !== baseUrl.origin || url.username !== "" || url.password !== "" || url.pathname !== expectedPath || url.hash !== "") {
    throw new TypeError("Invalid Mastodon safety pagination URL.");
  }
  return url.toString();
}

function account(value: unknown): RecommendationMastodonSafetyAccount {
  if (!record(value)) throw new TypeError("Invalid Mastodon safety account.");
  const id = text(value.id, "account ID", 512);
  const acct = text(value.acct, "account acct", 512).normalize("NFKC").toLocaleLowerCase("und");
  const result: RecommendationMastodonSafetyAccount = { id, acct };
  const separator = acct.lastIndexOf("@");
  if (separator > 0 && separator < acct.length - 1) result.domain = normalizeDomain(acct.slice(separator + 1));
  if (value.url !== undefined) {
    let url: URL;
    try { url = new URL(text(value.url, "account URL", 4_096)); } catch { throw new TypeError("Invalid Mastodon safety account URL."); }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new TypeError("Invalid Mastodon safety account URL.");
    result.url = url.toString();
    if (result.domain === undefined) result.domain = normalizeDomain(url.hostname);
  }
  return Object.freeze(result);
}

function filter(value: unknown): RecommendationMastodonFilter {
  if (!record(value)) throw new TypeError("Invalid Mastodon safety filter.");
  const contextsRaw = value.context;
  if (!Array.isArray(contextsRaw) || contextsRaw.length === 0 || contextsRaw.length > RECOMMENDATION_MASTODON_FILTER_CONTEXTS.length) throw new TypeError("Invalid Mastodon safety filter contexts.");
  const contexts = contextsRaw.map((raw): RecommendationMastodonFilterContext => {
    const normalized = text(raw, "filter context", 32);
    if (!FILTER_CONTEXTS.has(normalized)) throw new TypeError("Invalid Mastodon safety filter context.");
    return normalized as RecommendationMastodonFilterContext;
  });
  if (new Set(contexts).size !== contexts.length) throw new TypeError("Invalid Mastodon safety duplicate filter context.");
  const rawAction = value.filter_action === undefined ? "warn" : text(value.filter_action, "filter action", 32);
  const action: RecommendationMastodonFilterAction = FILTER_ACTIONS.has(rawAction) ? rawAction as RecommendationMastodonFilterAction : "warn";
  const expiresAt = value.expires_at === null || value.expires_at === undefined ? null : instant(value.expires_at, "filter expiration");
  const keywordsRaw = value.keywords ?? [];
  const statusesRaw = value.statuses ?? [];
  if (!Array.isArray(keywordsRaw) || keywordsRaw.length > MAX_ITEMS || !Array.isArray(statusesRaw) || statusesRaw.length > MAX_ITEMS) throw new TypeError("Invalid Mastodon safety filter members.");
  const keywords = keywordsRaw.map((raw): RecommendationMastodonFilterKeyword => {
    if (!record(raw) || typeof raw.whole_word !== "boolean") throw new TypeError("Invalid Mastodon safety filter keyword.");
    return Object.freeze({ id: text(raw.id, "filter keyword ID", 512), keyword: text(raw.keyword, "filter keyword", 1_024).normalize("NFKC"), wholeWord: raw.whole_word });
  });
  const statuses = statusesRaw.map((raw): RecommendationMastodonFilterStatus => {
    if (!record(raw)) throw new TypeError("Invalid Mastodon safety filter status.");
    return Object.freeze({ id: text(raw.id, "filter status ID", 512), statusId: text(raw.status_id, "filtered status ID", 512) });
  });
  return Object.freeze({ id: text(value.id, "filter ID", 512), title: text(value.title, "filter title", 1_024), contexts: Object.freeze(contexts), expiresAt, action, keywords: Object.freeze(keywords), statuses: Object.freeze(statuses) });
}

function pageClient<T>(input: { baseUrl: string; path: string; requiredScope: string; limit: number; transport: RecommendationMastodonViewerSafetyTransport; parse: (value: unknown) => T }) {
  const baseUrl = safeBaseUrl(input.baseUrl);
  if (!record(input.transport) || typeof input.transport.get !== "function") throw new TypeError("Invalid Mastodon safety transport.");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) throw new TypeError("Invalid Mastodon safety response limit.");
  const initialUrl = new URL(`${input.path}?limit=${input.limit}`, baseUrl);
  return Object.freeze({
    async readPage(readInput: RecommendationMastodonViewerSafetyReadInput & { nextUrl?: string }): Promise<RecommendationMastodonViewerSafetyPage<T>> {
      if (!record(readInput)) throw new TypeError("Invalid Mastodon safety read input.");
      const subjectId = text(readInput.subjectId, "subject ID", 512);
      authorize(readInput.authorization, subjectId, readInput.grantedScopes, input.requiredScope);
      const url = readInput.nextUrl === undefined ? initialUrl.toString() : sameOriginPageUrl(readInput.nextUrl, baseUrl, input.path);
      if (url === undefined) throw new TypeError("Invalid Mastodon safety pagination URL.");
      const response = await input.transport.get({ url, requiresAuthentication: true, ...(readInput.signal === undefined ? {} : { signal: readInput.signal }) });
      if (!record(response) || !Array.isArray(response.body) || response.body.length > input.limit) throw new TypeError("Invalid Mastodon safety transport response.");
      const observedAt = instant(response.observedAt, "observation timestamp");
      const nextUrl = sameOriginPageUrl(response.nextUrl, baseUrl, input.path);
      return Object.freeze({ items: Object.freeze(response.body.map(input.parse)), observedAt, ...(nextUrl === undefined ? {} : { nextUrl }) });
    }
  });
}

export function createRecommendationMastodonBlocksClient(input: { baseUrl: string; transport: RecommendationMastodonViewerSafetyTransport; limit?: number }) {
  return pageClient({ ...input, path: "/api/v1/blocks", requiredScope: "read:blocks", limit: input.limit ?? 80, parse: account });
}

export function createRecommendationMastodonMutesClient(input: { baseUrl: string; transport: RecommendationMastodonViewerSafetyTransport; limit?: number }) {
  return pageClient({ ...input, path: "/api/v1/mutes", requiredScope: "read:mutes", limit: input.limit ?? 80, parse: account });
}

export function createRecommendationMastodonDomainBlocksClient(input: { baseUrl: string; transport: RecommendationMastodonViewerSafetyTransport; limit?: number }) {
  return pageClient({ ...input, path: "/api/v1/domain_blocks", requiredScope: "read:blocks", limit: input.limit ?? 200, parse: normalizeDomain });
}

export function createRecommendationMastodonFiltersClient(input: { baseUrl: string; transport: RecommendationMastodonViewerSafetyTransport; limit?: number }) {
  return pageClient({ ...input, path: "/api/v2/filters", requiredScope: "read:filters", limit: input.limit ?? 200, parse: filter });
}

function keywordMatches(haystack: string, keyword: RecommendationMastodonFilterKeyword): boolean {
  const normalizedHaystack = haystack.normalize("NFKC").toLocaleLowerCase("und");
  const normalizedNeedle = keyword.keyword.toLocaleLowerCase("und");
  if (!keyword.wholeWord) return normalizedHaystack.includes(normalizedNeedle);
  const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{Letter}\\p{Number}_])${escaped}(?![\\p{Letter}\\p{Number}_])`, "iu").test(normalizedHaystack);
}

export function evaluateRecommendationMastodonViewerSafety(input: { snapshot: RecommendationMastodonViewerSafetySnapshot; candidate: RecommendationMastodonSafetyCandidate; now: string }): RecommendationMastodonSafetyDecision {
  if (!record(input) || !record(input.snapshot) || !record(input.candidate)) throw new TypeError("Invalid Mastodon safety evaluation input.");
  const nowMs = Date.parse(instant(input.now, "evaluation timestamp"));
  const reasons = new Set<string>();
  const matchedFilterIds = new Set<string>();
  let eligible = true;
  let mediaEligible = true;
  let warningRequired = false;
  const candidateId = input.candidate.accountId === undefined ? undefined : text(input.candidate.accountId, "candidate account ID", 512);
  const candidateAcct = input.candidate.accountAcct === undefined ? undefined : text(input.candidate.accountAcct, "candidate account acct", 512).normalize("NFKC").toLocaleLowerCase("und");
  const candidateDomain = input.candidate.domain === undefined ? undefined : normalizeDomain(input.candidate.domain);
  const statusId = input.candidate.statusId === undefined ? undefined : text(input.candidate.statusId, "candidate status ID", 512);
  const candidateText = input.candidate.text === undefined ? undefined : text(input.candidate.text, "candidate text", MAX_TEXT);
  if (!FILTER_CONTEXTS.has(input.candidate.context)) throw new TypeError("Invalid Mastodon safety candidate context.");

  if (input.snapshot.blockedAccounts.some((item) => item.id === candidateId || item.acct === candidateAcct)) {
    eligible = false;
    reasons.add("viewer_blocked_account");
  }
  if (input.snapshot.mutedAccounts.some((item) => item.id === candidateId || item.acct === candidateAcct)) {
    eligible = false;
    reasons.add("viewer_muted_account");
  }
  if (candidateDomain !== undefined && input.snapshot.blockedDomains.some((domain) => domain === candidateDomain || candidateDomain.endsWith(`.${domain}`))) {
    eligible = false;
    reasons.add("viewer_blocked_domain");
  }

  for (const item of input.snapshot.filters) {
    if (!item.contexts.includes(input.candidate.context)) continue;
    if (item.expiresAt !== null && Date.parse(item.expiresAt) <= nowMs) continue;
    const matchesStatus = statusId !== undefined && item.statuses.some((entry) => entry.statusId === statusId);
    const matchesKeyword = candidateText !== undefined && item.keywords.some((entry) => keywordMatches(candidateText, entry));
    if (!matchesStatus && !matchesKeyword) continue;
    matchedFilterIds.add(item.id);
    if (item.action === "hide") {
      eligible = false;
      reasons.add("viewer_filter_hide");
    } else if (item.action === "blur" && input.candidate.hasMedia === true) {
      mediaEligible = false;
      warningRequired = true;
      reasons.add("viewer_filter_blur");
    } else {
      warningRequired = true;
      reasons.add("viewer_filter_warn");
    }
  }

  return Object.freeze({ eligible, mediaEligible, warningRequired, reasonCodes: Object.freeze([...reasons]), matchedFilterIds: Object.freeze([...matchedFilterIds]) });
}

export function createRecommendationMastodonViewerSafetySnapshot(input: RecommendationMastodonViewerSafetySnapshot): RecommendationMastodonViewerSafetySnapshot {
  if (!record(input)) throw new TypeError("Invalid Mastodon safety snapshot.");
  return Object.freeze({
    subjectId: text(input.subjectId, "snapshot subject ID", 512),
    observedAt: instant(input.observedAt, "snapshot observation timestamp"),
    blockedAccounts: Object.freeze(input.blockedAccounts.map(account)),
    mutedAccounts: Object.freeze(input.mutedAccounts.map(account)),
    blockedDomains: Object.freeze(input.blockedDomains.map(normalizeDomain)),
    filters: Object.freeze(input.filters.map(filter))
  });
}
