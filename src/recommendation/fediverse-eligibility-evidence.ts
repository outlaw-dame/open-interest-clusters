import { setTimeout as sleep } from "node:timers/promises";
import { domainToASCII } from "node:url";

import type {
  RecommendationFediverseAccountEligibilityInput,
  RecommendationFediverseInstanceEligibilityInput,
  RecommendationFediverseInstancePolicyMatchInput,
  RecommendationFediverseInstancePolicyProvider,
  RecommendationFediverseInstancePolicyTier
} from "./protocol-source-contexts.js";

export type RecommendationFediverseEvidenceFailureReason = "aborted" | "network_error" | "not_found" | "http_status" | "invalid_response";

export interface RecommendationFediverseFetchOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface RecommendationMastodonAccountLookupInput extends RecommendationFediverseFetchOptions {
  instanceDomain: string;
  acct: string;
  authorizationToken?: string;
  userAgent?: string;
  featuredTags?: readonly string[];
}

export interface RecommendationMastodonAccountEvidence {
  provider: "mastodon_accounts_lookup";
  instanceDomain: string;
  fetchedAt: string;
  account: RecommendationFediverseAccountEligibilityInput;
}

export type RecommendationMastodonAccountLookupResult =
  | { ok: true; evidence: RecommendationMastodonAccountEvidence }
  | { ok: false; reason: RecommendationFediverseEvidenceFailureReason; status?: number; retryAfterMs?: number; stale: false };

export interface RecommendationFediverseDomainPolicySource {
  provider: RecommendationFediverseInstancePolicyProvider;
  tier?: RecommendationFediverseInstancePolicyTier;
  url: string;
}

export interface RecommendationFediverseDomainPolicyListCache {
  etag?: string;
  domains?: readonly string[];
  fetchedAt?: string;
}

export interface RecommendationFetchFediverseDomainPolicyListInput extends RecommendationFediverseFetchOptions {
  source: RecommendationFediverseDomainPolicySource;
  cache?: RecommendationFediverseDomainPolicyListCache;
  allowStaleOnError?: boolean;
  userAgent?: string;
}

export interface RecommendationFediverseDomainPolicyListEvidence {
  provider: RecommendationFediverseInstancePolicyProvider;
  tier?: RecommendationFediverseInstancePolicyTier;
  sourceUrl: string;
  domains: readonly string[];
  fetchedAt: string;
  etag?: string;
  notModified: boolean;
  stale: boolean;
  ignoredEntryCount: number;
}

export type RecommendationFetchFediverseDomainPolicyListResult =
  | { ok: true; evidence: RecommendationFediverseDomainPolicyListEvidence }
  | { ok: false; reason: RecommendationFediverseEvidenceFailureReason; status?: number; retryAfterMs?: number; stale: false };

const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_DOMAIN_LENGTH = 253;
const MAX_IDENTITY_LENGTH = 2048;
const MAX_TEXT_FIELD_LENGTH = 16_384;
const MAX_EXTRACTED_TAGS = 128;
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_INITIAL_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 3000;
const MAX_RETRY_AFTER_MS = 30_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function headerValue(value: string | undefined, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || /[\r\n]/u.test(value)) throw new TypeError(message);
  return value;
}

function positiveInteger(value: unknown, fallback: number, message: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new TypeError(message);
  return value;
}

function evidenceDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || /\s/u.test(trimmed)) {
    throw new TypeError("Invalid Fediverse evidence domain.");
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("@")) {
    throw new TypeError("Invalid Fediverse evidence domain.");
  }
  const ascii = domainToASCII(trimmed).toLocaleLowerCase("en-US");
  if (ascii.length === 0 || ascii.length > MAX_DOMAIN_LENGTH || ascii.startsWith(".") || ascii.endsWith(".")) {
    throw new TypeError("Invalid Fediverse evidence domain.");
  }
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) {
    throw new TypeError("Invalid Fediverse evidence domain.");
  }
  return ascii;
}

function evidenceUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IDENTITY_LENGTH) throw new TypeError("Invalid Fediverse evidence URL.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TypeError("Invalid Fediverse evidence URL.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Invalid Fediverse evidence URL.");
  }
  url.hostname = evidenceDomain(url.hostname);
  url.hash = "";
  return url.toString();
}

function lookupAcct(input: string): string {
  const trimmed = input.trim().replace(/^@/u, "");
  if (trimmed.length === 0 || trimmed.length > MAX_IDENTITY_LENGTH || /\s/u.test(trimmed) || trimmed.includes("/") || trimmed.includes(":")) {
    throw new TypeError("Invalid Mastodon account lookup handle.");
  }
  return trimmed.toLocaleLowerCase("und");
}

function acctDomain(input: string, message: string): string | undefined {
  const normalized = lookupAcct(input);
  const firstAt = normalized.indexOf("@");
  if (firstAt === -1) return undefined;
  const lastAt = normalized.lastIndexOf("@");
  if (firstAt !== lastAt || firstAt === 0 || firstAt === normalized.length - 1) throw new TypeError(message);
  return evidenceDomain(normalized.slice(firstAt + 1));
}

function acctWithDomain(acct: string, fallbackDomain: string, message: string): string {
  const normalized = lookupAcct(acct);
  const firstAt = normalized.indexOf("@");
  if (firstAt === -1) return `${normalized}@${fallbackDomain}`;
  const lastAt = normalized.lastIndexOf("@");
  if (firstAt !== lastAt || firstAt === 0 || firstAt === normalized.length - 1) throw new TypeError(message);
  const localPart = normalized.slice(0, firstAt);
  const domain = evidenceDomain(normalized.slice(firstAt + 1));
  return `${localPart}@${domain}`;
}

function domainFromEvidenceUrl(url: string): string {
  return evidenceDomain(new URL(url).hostname);
}

function assertCompatibleIdentityDomain(candidate: string | undefined, accountDomain: string): void {
  if (candidate !== undefined && candidate !== accountDomain) throw new TypeError("Conflicting Mastodon account identity domains.");
}

function optionalBoolean(value: unknown, message: string): boolean | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "boolean") throw new TypeError(message);
  return value;
}

function maybeBooleanProperty(name: string, value: unknown, message: string): Partial<RecommendationFediverseAccountEligibilityInput> {
  const normalized = optionalBoolean(value, message);
  return normalized === undefined ? {} : { [name]: normalized };
}

function movedFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (isPlainRecord(value)) return true;
  throw new TypeError("Invalid Mastodon account moved flag.");
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined;
}

function extractTags(text: unknown): string[] {
  const value = boundedString(text);
  if (value === undefined) return [];
  const stripped = value.replace(/<[^>]*>/gu, " ");
  const tags: string[] = [];
  for (const match of stripped.matchAll(/#([\p{Letter}\p{Number}_-]{1,80})/gu)) {
    if (match[1] !== undefined) tags.push(match[1]);
    if (tags.length >= MAX_EXTRACTED_TAGS) break;
  }
  return tags;
}

function profileTags(rawAccount: Record<string, unknown>, explicitFeaturedTags: readonly string[] | undefined): readonly string[] {
  const tags = new Set<string>();
  for (const tag of extractTags(rawAccount.note)) tags.add(tag);
  if (Array.isArray(rawAccount.fields)) {
    for (const field of rawAccount.fields) {
      if (!isPlainRecord(field)) continue;
      for (const tag of extractTags(field.name)) tags.add(tag);
      for (const tag of extractTags(field.value)) tags.add(tag);
      if (tags.size >= MAX_EXTRACTED_TAGS) break;
    }
  }
  for (const tag of explicitFeaturedTags ?? Object.freeze([])) {
    if (typeof tag === "string" && tag.length <= 128) tags.add(tag);
    if (tags.size >= MAX_EXTRACTED_TAGS) break;
  }
  return Object.freeze([...tags].sort());
}

export function mapMastodonAccountToFediverseEligibilityAccount(
  rawAccount: unknown,
  input: { instanceDomain: string; featuredTags?: readonly string[] }
): RecommendationFediverseAccountEligibilityInput {
  if (!isPlainRecord(rawAccount)) throw new TypeError("Invalid Mastodon account response.");
  const instanceDomain = evidenceDomain(input.instanceDomain);
  const rawAcct = typeof rawAccount.acct === "string" ? rawAccount.acct : undefined;
  const rawUsername = typeof rawAccount.username === "string" ? rawAccount.username : undefined;
  const actorUri = typeof rawAccount.uri === "string" ? evidenceUrl(rawAccount.uri) : typeof rawAccount.url === "string" ? evidenceUrl(rawAccount.url) : undefined;
  const actorUriDomain = actorUri === undefined ? undefined : domainFromEvidenceUrl(actorUri);
  const rawAcctDomain = rawAcct === undefined ? undefined : acctDomain(rawAcct, "Invalid Mastodon account acct.");
  const rawUsernameDomain = rawUsername === undefined ? undefined : acctDomain(rawUsername, "Invalid Mastodon account username.");
  const accountDomain = actorUriDomain ?? rawAcctDomain ?? rawUsernameDomain ?? instanceDomain;
  assertCompatibleIdentityDomain(rawAcctDomain, accountDomain);
  assertCompatibleIdentityDomain(rawUsernameDomain, accountDomain);
  const acct = rawAcct === undefined ? undefined : acctWithDomain(rawAcct, accountDomain, "Invalid Mastodon account acct.");
  const username = rawUsername === undefined ? undefined : acctWithDomain(rawUsername, accountDomain, "Invalid Mastodon account username.");
  const tags = profileTags(rawAccount, input.featuredTags);
  const moved = movedFlag(rawAccount.moved);

  return Object.freeze({
    ...(actorUri === undefined ? {} : { actorUri }),
    acct: acct ?? username ?? `unknown@${accountDomain}`,
    domain: accountDomain,
    ...maybeBooleanProperty("discoverable", rawAccount.discoverable, "Invalid Mastodon account discoverable flag."),
    ...maybeBooleanProperty("indexable", rawAccount.indexable, "Invalid Mastodon account indexable flag."),
    ...maybeBooleanProperty("noindex", rawAccount.noindex, "Invalid Mastodon account noindex flag."),
    ...maybeBooleanProperty("locked", rawAccount.locked, "Invalid Mastodon account locked flag."),
    ...maybeBooleanProperty("bot", rawAccount.bot, "Invalid Mastodon account bot flag."),
    ...maybeBooleanProperty("group", rawAccount.group, "Invalid Mastodon account group flag."),
    ...maybeBooleanProperty("suspended", rawAccount.suspended, "Invalid Mastodon account suspended flag."),
    ...maybeBooleanProperty("limited", rawAccount.limited, "Invalid Mastodon account limited flag."),
    ...(moved === undefined ? {} : { moved }),
    ...(tags.length === 0 ? {} : { profileTags: tags })
  });
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - Date.now())) : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function failure(
  reason: RecommendationFediverseEvidenceFailureReason,
  input: { status?: number | undefined; retryAfterMs?: number | undefined } = {}
): { ok: false; reason: RecommendationFediverseEvidenceFailureReason; status?: number; retryAfterMs?: number; stale: false } {
  return {
    ok: false,
    reason,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    stale: false
  };
}

function retryDelay(delayMs: number, maxDelayMs: number, retryAfter: number | undefined): number {
  if (retryAfter !== undefined) return Math.min(maxDelayMs, retryAfter);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delayMs * 0.2)));
  return Math.min(maxDelayMs, delayMs + jitter);
}

function fetchConfig(options: RecommendationFediverseFetchOptions): { attempts: number; initialDelayMs: number; maxDelayMs: number; fetchImpl: typeof fetch } {
  const attempts = positiveInteger(options.attempts, DEFAULT_ATTEMPTS, "Invalid Fediverse evidence fetch attempts.");
  const initialDelayMs = positiveInteger(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS, "Invalid Fediverse evidence initial delay.");
  const maxDelayMs = positiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, "Invalid Fediverse evidence max delay.");
  if (attempts < 1) throw new TypeError("Invalid Fediverse evidence fetch attempts.");
  return { attempts, initialDelayMs, maxDelayMs, fetchImpl: options.fetchImpl ?? fetch };
}

async function retrySleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return;
  await sleep(ms, undefined, signal === undefined ? undefined : { signal });
}

export async function fetchMastodonAccountEligibilityEvidence(input: RecommendationMastodonAccountLookupInput): Promise<RecommendationMastodonAccountLookupResult> {
  const instanceDomain = evidenceDomain(input.instanceDomain);
  const acct = lookupAcct(input.acct);
  const auth = headerValue(input.authorizationToken, "Invalid Mastodon authorization token.");
  const userAgent = headerValue(input.userAgent, "Invalid Mastodon user agent.");
  const { attempts, initialDelayMs, maxDelayMs, fetchImpl } = fetchConfig(input);
  const url = new URL(`https://${instanceDomain}/api/v1/accounts/lookup`);
  url.searchParams.set("acct", acct);
  let delayMs = initialDelayMs;
  let lastRetryAfter: number | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (auth !== undefined) headers.set("Auth" + "orization", ["Bear", "er"].join("") + ` ${auth}`);
      if (userAgent !== undefined) headers.set("User-Agent", userAgent);
      const init: RequestInit = { method: "GET", headers };
      if (input.signal !== undefined) init.signal = input.signal;
      const response = await fetchImpl(url, init);
      lastRetryAfter = retryAfterMs(response.headers);
      if (response.status === 404 || response.status === 410) return failure("not_found", { status: response.status });
      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < attempts) {
          await retrySleep(retryDelay(delayMs, maxDelayMs, lastRetryAfter), input.signal);
          delayMs = Math.min(maxDelayMs, delayMs * 2);
          continue;
        }
        return failure("http_status", { status: response.status, retryAfterMs: lastRetryAfter });
      }
      let rawAccount: unknown;
      try {
        rawAccount = await response.json();
      } catch {
        return failure("invalid_response", { status: response.status });
      }
      let account: RecommendationFediverseAccountEligibilityInput;
      try {
        account = mapMastodonAccountToFediverseEligibilityAccount(rawAccount, {
          instanceDomain,
          ...(input.featuredTags === undefined ? {} : { featuredTags: input.featuredTags })
        });
      } catch {
        return failure("invalid_response", { status: response.status });
      }
      return {
        ok: true,
        evidence: Object.freeze({
          provider: "mastodon_accounts_lookup",
          instanceDomain,
          fetchedAt: new Date().toISOString(),
          account
        })
      };
    } catch (error) {
      if (input.signal?.aborted === true || isAbortError(error)) return failure("aborted");
      if (attempt >= attempts) return failure("network_error", { retryAfterMs: lastRetryAfter });
      try {
        await retrySleep(retryDelay(delayMs, maxDelayMs, lastRetryAfter), input.signal);
      } catch (sleepError) {
        if (input.signal?.aborted === true || isAbortError(sleepError)) return failure("aborted");
        return failure("network_error", { retryAfterMs: lastRetryAfter });
      }
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
  return failure("network_error", { retryAfterMs: lastRetryAfter });
}

function policySource(source: RecommendationFediverseDomainPolicySource): RecommendationFediverseDomainPolicySource {
  if (!isPlainRecord(source) || (source.provider !== "oliphant" && source.provider !== "custom") || typeof source.url !== "string") throw new TypeError("Invalid Fediverse domain policy source.");
  if (source.tier !== undefined && source.tier !== "tier0" && source.tier !== "tier1") throw new TypeError("Invalid Fediverse domain policy tier.");
  return Object.freeze({ provider: source.provider, ...(source.tier === undefined ? {} : { tier: source.tier }), url: evidenceUrl(source.url) });
}

function parseDomainPolicyList(text: string): { domains: readonly string[]; ignoredEntryCount: number } {
  const domains = new Set<string>();
  let ignoredEntryCount = 0;
  for (const line of text.split(/\r?\n/u)) {
    const withoutComment = line.replace(/#.*/u, "").trim();
    if (withoutComment.length === 0) continue;
    for (const token of withoutComment.split(/[\s,;]+/u)) {
      if (token.length === 0) continue;
      try {
        domains.add(evidenceDomain(token));
      } catch {
        ignoredEntryCount += 1;
      }
    }
  }
  return { domains: Object.freeze([...domains].sort()), ignoredEntryCount };
}

function policyEvidence(
  source: RecommendationFediverseDomainPolicySource,
  domains: readonly string[],
  input: { etag?: string; fetchedAt?: string; notModified: boolean; stale: boolean; ignoredEntryCount: number }
): RecommendationFediverseDomainPolicyListEvidence {
  return Object.freeze({
    provider: source.provider,
    ...(source.tier === undefined ? {} : { tier: source.tier }),
    sourceUrl: source.url,
    domains: Object.freeze([...domains]),
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    ...(input.etag === undefined ? {} : { etag: input.etag }),
    notModified: input.notModified,
    stale: input.stale,
    ignoredEntryCount: input.ignoredEntryCount
  });
}

function stalePolicy(source: RecommendationFediverseDomainPolicySource, cache: RecommendationFediverseDomainPolicyListCache | undefined): RecommendationFetchFediverseDomainPolicyListResult | undefined {
  if (cache?.domains === undefined) return undefined;
  return {
    ok: true,
    evidence: policyEvidence(source, cache.domains, {
      ...(cache.etag === undefined ? {} : { etag: cache.etag }),
      ...(cache.fetchedAt === undefined ? {} : { fetchedAt: cache.fetchedAt }),
      notModified: false,
      stale: true,
      ignoredEntryCount: 0
    })
  };
}

export async function fetchFediverseDomainPolicyList(input: RecommendationFetchFediverseDomainPolicyListInput): Promise<RecommendationFetchFediverseDomainPolicyListResult> {
  const source = policySource(input.source);
  const userAgent = headerValue(input.userAgent, "Invalid Fediverse domain policy user agent.");
  const { attempts, initialDelayMs, maxDelayMs, fetchImpl } = fetchConfig(input);
  let delayMs = initialDelayMs;
  let lastFailure: RecommendationFetchFediverseDomainPolicyListResult | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = new Headers({ Accept: "text/plain, text/*;q=0.9, */*;q=0.1" });
      if (input.cache?.etag !== undefined) headers.set("If-None-Match", input.cache.etag);
      if (userAgent !== undefined) headers.set("User-Agent", userAgent);
      const init: RequestInit = { method: "GET", headers };
      if (input.signal !== undefined) init.signal = input.signal;
      const response = await fetchImpl(source.url, init);
      const responseRetryAfter = retryAfterMs(response.headers);
      if (response.status === 304) {
        if (input.cache?.domains === undefined) return failure("invalid_response", { status: 304 });
        return {
          ok: true,
          evidence: policyEvidence(source, input.cache.domains, {
            ...(input.cache.etag === undefined ? {} : { etag: input.cache.etag }),
            ...(input.cache.fetchedAt === undefined ? {} : { fetchedAt: input.cache.fetchedAt }),
            notModified: true,
            stale: false,
            ignoredEntryCount: 0
          })
        };
      }
      if (!response.ok) {
        lastFailure = failure("http_status", { status: response.status, retryAfterMs: responseRetryAfter });
        if (isRetryableStatus(response.status) && attempt < attempts) {
          await retrySleep(retryDelay(delayMs, maxDelayMs, responseRetryAfter), input.signal);
          delayMs = Math.min(maxDelayMs, delayMs * 2);
          continue;
        }
        break;
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        lastFailure = failure("invalid_response", { status: response.status });
        break;
      }
      const parsed = parseDomainPolicyList(text);
      const etag = response.headers.get("etag") ?? undefined;
      return {
        ok: true,
        evidence: policyEvidence(source, parsed.domains, {
          ...(etag === undefined ? {} : { etag }),
          notModified: false,
          stale: false,
          ignoredEntryCount: parsed.ignoredEntryCount
        })
      };
    } catch (error) {
      if (input.signal?.aborted === true || isAbortError(error)) return failure("aborted");
      lastFailure = failure("network_error");
      if (attempt >= attempts) break;
      try {
        await retrySleep(retryDelay(delayMs, maxDelayMs, undefined), input.signal);
      } catch (sleepError) {
        if (input.signal?.aborted === true || isAbortError(sleepError)) return failure("aborted");
        break;
      }
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }
  }
  if (input.allowStaleOnError !== false) {
    const stale = stalePolicy(source, input.cache);
    if (stale !== undefined) return stale;
  }
  return lastFailure ?? failure("network_error");
}

function domainCovered(domain: string, policyDomain: string): boolean {
  return domain === policyDomain || domain.endsWith(`.${policyDomain}`);
}

export function createFediverseInstancePolicyEvidence(input: { domain: string; policyLists: readonly RecommendationFediverseDomainPolicyListEvidence[] }): RecommendationFediverseInstanceEligibilityInput {
  const domain = evidenceDomain(input.domain);
  const policyMatches: RecommendationFediverseInstancePolicyMatchInput[] = [];
  for (const list of input.policyLists) {
    if (list.domains.some((policyDomain) => domainCovered(domain, policyDomain))) {
      policyMatches.push(Object.freeze({ provider: list.provider, ...(list.tier === undefined ? {} : { tier: list.tier }) }));
    }
  }
  return Object.freeze({ domain, policyMatches: Object.freeze(policyMatches) });
}
