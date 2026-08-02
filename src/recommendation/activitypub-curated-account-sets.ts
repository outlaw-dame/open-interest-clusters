import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS = [
  "mastodon_collection",
  "loops_starter_kit",
  "pixelfed_starter_kit"
] as const;
export type RecommendationCuratedAccountSetProvider =
  typeof RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS[number];

export const RECOMMENDATION_CURATED_ACCOUNT_MEMBERSHIP_STATES = [
  "accepted",
  "pending",
  "rejected",
  "revoked",
  "unknown"
] as const;
export type RecommendationCuratedAccountMembershipState =
  typeof RECOMMENDATION_CURATED_ACCOUNT_MEMBERSHIP_STATES[number];

export interface RecommendationCuratedAccountMember {
  accountId: string;
  accountUri?: string;
  handle?: string;
  state: RecommendationCuratedAccountMembershipState;
}

export interface RecommendationCuratedAccountSet {
  provider: RecommendationCuratedAccountSetProvider;
  id: string;
  url: string;
  curatorId: string;
  curatorUri?: string;
  name: string;
  description?: string;
  discoverable: boolean;
  sensitive: boolean;
  observedAt: string;
  updatedAt?: string;
  hashtags: readonly string[];
  members: readonly RecommendationCuratedAccountMember[];
  trustBoundary: "same_provider" | "remote_provider" | "unknown";
  membershipComplete: boolean;
}

export interface RecommendationCuratedAccountSetTransportRequest {
  url: string;
  requiresAuthentication: boolean;
  signal?: AbortSignal;
}

export interface RecommendationCuratedAccountSetTransportResponse {
  body: unknown;
  observedAt: string;
}

export interface RecommendationCuratedAccountSetTransport {
  get(
    request: RecommendationCuratedAccountSetTransportRequest
  ): RecommendationCuratedAccountSetTransportResponse | Promise<RecommendationCuratedAccountSetTransportResponse>;
}

export interface RecommendationCuratedAccountSetReadInput {
  subjectId: string;
  authorization: RecommendationProtocolSourceReadAuthorization;
  signal?: AbortSignal;
}

export interface RecommendationMastodonCollectionClientInput {
  baseUrl: string;
  collectionId: string;
  authenticated?: boolean;
  transport: RecommendationCuratedAccountSetTransport;
}

export interface RecommendationLoopsStarterKitClientInput {
  baseUrl: string;
  starterKitId: string;
  authenticatedAccounts?: boolean;
  transport: RecommendationCuratedAccountSetTransport;
}

export interface RecommendationPixelfedStarterKitClientInput {
  documentUrl: string;
  authenticated?: boolean;
  transport: RecommendationCuratedAccountSetTransport;
}

const MAX_URL_LENGTH = 2_048;
const MAX_ID_LENGTH = 512;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_MEMBERS = 150;
const MAX_HASHTAGS = 32;
const PROVIDER_SET = new Set<string>(RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS);
const MEMBERSHIP_SET = new Set<string>(RECOMMENDATION_CURATED_ACCOUNT_MEMBERSHIP_STATES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid curated account set ${label}.`);
  }
  return value;
}

function optionalBounded(value: unknown, maximum: number, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return bounded(value, maximum, label);
}

function safeUrl(value: unknown, label: string): URL {
  const raw = bounded(value, MAX_URL_LENGTH, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid curated account set ${label}.`);
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    host.length === 0 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) ||
    host.includes(":")
  ) {
    throw new TypeError(`Invalid curated account set ${label}.`);
  }
  url.hostname = host;
  url.hash = "";
  return url;
}

function rootUrl(value: unknown): URL {
  const url = safeUrl(value, "base URL");
  if ((url.pathname !== "" && url.pathname !== "/") || url.search !== "") {
    throw new TypeError("Invalid curated account set base URL.");
  }
  url.pathname = "/";
  return url;
}

function timestamp(value: unknown, label: string): string {
  const normalized = bounded(value, MAX_ID_LENGTH, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "curated-account-set", since: normalized });
  return normalized;
}

function validateAuthorization(
  authorization: unknown,
  subjectId: string,
  requiresAuthentication: boolean
): RecommendationProtocolSourceReadAuthorization {
  if (
    !isRecord(authorization) ||
    authorization.status !== "authorized" ||
    authorization.subjectId !== subjectId ||
    typeof authorization.checkedAt !== "string" ||
    typeof authorization.sourceVisibility !== "string" ||
    typeof authorization.accessBasis !== "string"
  ) {
    throw new TypeError("Invalid curated account set authorization.");
  }
  timestamp(authorization.checkedAt, "authorization timestamp");
  if (requiresAuthentication && authorization.accessBasis !== "oauth_scope" && authorization.accessBasis !== "authenticated_api") {
    throw new TypeError("Curated account set requires authenticated authorization evidence.");
  }
  if (!requiresAuthentication && authorization.accessBasis === "unknown") {
    throw new TypeError("Curated account set requires public-read authorization evidence.");
  }
  return authorization as unknown as RecommendationProtocolSourceReadAuthorization;
}

function unwrapData(value: unknown): unknown {
  return isRecord(value) && value.data !== undefined ? value.data : value;
}

function normalizeHashtags(value: unknown): readonly string[] {
  const input = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const output = new Set<string>();
  for (const entry of input) {
    const raw = isRecord(entry) ? entry.name : entry;
    if (typeof raw !== "string") continue;
    const tag = (raw.startsWith("#") ? raw.slice(1) : raw).trim().toLocaleLowerCase("und");
    if (tag.length > 0 && tag.length <= 80 && !hasUnsafeControlCharacter(tag)) output.add(tag);
    if (output.size >= MAX_HASHTAGS) break;
  }
  return Object.freeze([...output]);
}

function member(
  accountId: unknown,
  accountUri: unknown,
  handle: unknown,
  state: unknown = "accepted"
): RecommendationCuratedAccountMember {
  const normalizedState = typeof state === "string" && MEMBERSHIP_SET.has(state) ? state : "unknown";
  const result: RecommendationCuratedAccountMember = {
    accountId: bounded(accountId, MAX_ID_LENGTH, "member account ID"),
    state: normalizedState as RecommendationCuratedAccountMembershipState
  };
  const uri = optionalBounded(accountUri, MAX_URL_LENGTH, "member account URI");
  const normalizedHandle = optionalBounded(handle, MAX_ID_LENGTH, "member handle");
  if (uri !== undefined) result.accountUri = safeUrl(uri, "member account URI").toString();
  if (normalizedHandle !== undefined) result.handle = normalizedHandle;
  return Object.freeze(result);
}

function trustBoundary(resourceUrl: URL, baseUrl: URL): "same_provider" | "remote_provider" {
  return resourceUrl.origin === baseUrl.origin ? "same_provider" : "remote_provider";
}

function normalizeSet(input: RecommendationCuratedAccountSet): RecommendationCuratedAccountSet {
  if (!PROVIDER_SET.has(input.provider) || input.members.length > MAX_MEMBERS) {
    throw new TypeError("Invalid curated account set.");
  }
  return Object.freeze({
    ...input,
    hashtags: Object.freeze([...input.hashtags]),
    members: Object.freeze([...input.members])
  });
}

function mastodonCollection(body: unknown, observedAt: string, baseUrl: URL): RecommendationCuratedAccountSet {
  if (!isRecord(body)) throw new TypeError("Invalid Mastodon collection response.");
  const collection = isRecord(body.collection) ? body.collection : body;
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  if (!isRecord(collection) || accounts.length > MAX_MEMBERS || accounts.some((entry) => !isRecord(entry))) {
    throw new TypeError("Invalid Mastodon collection response.");
  }
  const items = Array.isArray(collection.items) ? collection.items : [];
  const states = new Map<string, string>();
  for (const item of items) {
    if (isRecord(item) && typeof item.account_id === "string" && typeof item.state === "string") {
      states.set(item.account_id, item.state);
    }
  }
  const ownerId = bounded(collection.account_id, MAX_ID_LENGTH, "curator ID");
  const resourceUrl = safeUrl(collection.url ?? collection.uri, "resource URL");
  const members = accounts
    .filter((account) => account.id !== ownerId)
    .map((account) => member(account.id, account.url ?? account.uri, account.acct ?? account.username, states.get(String(account.id)) ?? "accepted"));
  return normalizeSet({
    provider: "mastodon_collection",
    id: bounded(collection.id, MAX_ID_LENGTH, "ID"),
    url: resourceUrl.toString(),
    curatorId: ownerId,
    name: bounded(collection.name, MAX_NAME_LENGTH, "name"),
    ...(optionalBounded(collection.description, MAX_DESCRIPTION_LENGTH, "description") === undefined
      ? {}
      : { description: optionalBounded(collection.description, MAX_DESCRIPTION_LENGTH, "description") }),
    discoverable: collection.discoverable === true,
    sensitive: collection.sensitive === true,
    observedAt,
    ...(collection.updated_at === undefined ? {} : { updatedAt: timestamp(collection.updated_at, "updated timestamp") }),
    hashtags: normalizeHashtags(collection.tag),
    members,
    trustBoundary: trustBoundary(resourceUrl, baseUrl),
    membershipComplete: true
  });
}

function loopsStarterKit(body: unknown, observedAt: string, baseUrl: URL): RecommendationCuratedAccountSet {
  const value = unwrapData(body);
  if (!isRecord(value)) throw new TypeError("Invalid Loops starter kit response.");
  const creator = isRecord(value.creator) ? value.creator : undefined;
  if (creator === undefined) throw new TypeError("Invalid Loops starter kit response.");
  const accountsValue = Array.isArray(value.accounts) ? value.accounts : [];
  if (accountsValue.length > MAX_MEMBERS || accountsValue.some((entry) => !isRecord(entry))) {
    throw new TypeError("Invalid Loops starter kit response.");
  }
  const resourceUrl = safeUrl(value.remote_url ?? value.url, "resource URL");
  const members = accountsValue.map((account) => member(
    account.id ?? account.profile_id,
    account.url ?? account.uri,
    account.username ?? account.acct,
    account.kit_status === 1 || account.status === "approved" ? "accepted" : account.status ?? "unknown"
  ));
  return normalizeSet({
    provider: "loops_starter_kit",
    id: bounded(value.id, MAX_ID_LENGTH, "ID"),
    url: resourceUrl.toString(),
    curatorId: bounded(creator.id, MAX_ID_LENGTH, "curator ID"),
    ...(optionalBounded(creator.url ?? creator.uri, MAX_URL_LENGTH, "curator URI") === undefined
      ? {}
      : { curatorUri: safeUrl(creator.url ?? creator.uri, "curator URI").toString() }),
    name: bounded(value.title ?? value.name, MAX_NAME_LENGTH, "name"),
    ...(optionalBounded(value.description, MAX_DESCRIPTION_LENGTH, "description") === undefined
      ? {}
      : { description: optionalBounded(value.description, MAX_DESCRIPTION_LENGTH, "description") }),
    discoverable: value.is_discoverable === true,
    sensitive: value.is_sensitive === true,
    observedAt,
    ...(value.updated_at === undefined ? {} : { updatedAt: timestamp(value.updated_at, "updated timestamp") }),
    hashtags: normalizeHashtags(value.hashtags),
    members,
    trustBoundary: trustBoundary(resourceUrl, baseUrl),
    membershipComplete: Array.isArray(value.accounts)
  });
}

function pixelfedStarterKit(body: unknown, observedAt: string, documentUrl: URL): RecommendationCuratedAccountSet {
  const value = unwrapData(body);
  if (!isRecord(value)) throw new TypeError("Invalid Pixelfed starter kit document.");
  const actions = Array.isArray(value.actions) ? value.actions : [];
  if (actions.length > 1_000 || actions.some((entry) => !isRecord(entry))) {
    throw new TypeError("Invalid Pixelfed starter kit document.");
  }
  const members: RecommendationCuratedAccountMember[] = [];
  for (const action of actions) {
    const actionType = action.type ?? action.action;
    if (actionType !== "Follow" && actionType !== "follow") continue;
    const target = isRecord(action.target) ? action.target : action;
    const accountId = target.id ?? target.account_id ?? target.url;
    if (accountId === undefined) continue;
    members.push(member(String(accountId), target.url ?? target.id, target.handle ?? target.acct, "accepted"));
    if (members.length > MAX_MEMBERS) throw new TypeError("Invalid Pixelfed starter kit document.");
  }
  const resourceUrl = safeUrl(value.url ?? value.id ?? documentUrl.toString(), "resource URL");
  const curator = isRecord(value.creator) ? value.creator : isRecord(value.attributedTo) ? value.attributedTo : undefined;
  const curatorId = curator === undefined ? value.creator_id ?? value.attributedTo : curator.id ?? curator.url;
  return normalizeSet({
    provider: "pixelfed_starter_kit",
    id: bounded(value.id ?? resourceUrl.toString(), MAX_URL_LENGTH, "ID"),
    url: resourceUrl.toString(),
    curatorId: bounded(curatorId, MAX_URL_LENGTH, "curator ID"),
    ...(curator !== undefined && (curator.url !== undefined || curator.id !== undefined)
      ? { curatorUri: safeUrl(curator.url ?? curator.id, "curator URI").toString() }
      : {}),
    name: bounded(value.name ?? value.title, MAX_NAME_LENGTH, "name"),
    ...(optionalBounded(value.description ?? value.summary, MAX_DESCRIPTION_LENGTH, "description") === undefined
      ? {}
      : { description: optionalBounded(value.description ?? value.summary, MAX_DESCRIPTION_LENGTH, "description") }),
    discoverable: value.discoverable !== false,
    sensitive: value.sensitive === true,
    observedAt,
    ...(value.updated !== undefined ? { updatedAt: timestamp(value.updated, "updated timestamp") } : {}),
    hashtags: normalizeHashtags(value.hashtags ?? value.tags),
    members,
    trustBoundary: resourceUrl.origin === documentUrl.origin ? "same_provider" : "remote_provider",
    membershipComplete: true
  });
}

function client(
  url: URL,
  requiresAuthentication: boolean,
  transport: RecommendationCuratedAccountSetTransport,
  parse: (body: unknown, observedAt: string) => RecommendationCuratedAccountSet
): { read(input: RecommendationCuratedAccountSetReadInput): Promise<RecommendationCuratedAccountSet> } {
  if (!isRecord(transport) || typeof transport.get !== "function") {
    throw new TypeError("Invalid curated account set transport.");
  }
  return Object.freeze({
    async read(input) {
      if (!isRecord(input)) throw new TypeError("Invalid curated account set read input.");
      const subjectId = bounded(input.subjectId, MAX_ID_LENGTH, "subject ID");
      validateAuthorization(input.authorization, subjectId, requiresAuthentication);
      const response = await transport.get({
        url: url.toString(),
        requiresAuthentication,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      if (!isRecord(response)) throw new TypeError("Invalid curated account set transport response.");
      const observedAt = timestamp(response.observedAt, "observation timestamp");
      return parse(response.body, observedAt);
    }
  });
}

export function createRecommendationMastodonCollectionClient(
  input: RecommendationMastodonCollectionClientInput
): { read(input: RecommendationCuratedAccountSetReadInput): Promise<RecommendationCuratedAccountSet> } {
  if (!isRecord(input)) throw new TypeError("Invalid Mastodon collection client input.");
  const baseUrl = rootUrl(input.baseUrl);
  const id = bounded(input.collectionId, MAX_ID_LENGTH, "collection ID");
  const url = new URL(`/api/v1/collections/${encodeURIComponent(id)}`, baseUrl);
  return client(url, input.authenticated === true, input.transport, (body, observedAt) => mastodonCollection(body, observedAt, baseUrl));
}

export function createRecommendationLoopsStarterKitClient(
  input: RecommendationLoopsStarterKitClientInput
): { read(input: RecommendationCuratedAccountSetReadInput): Promise<RecommendationCuratedAccountSet> } {
  if (!isRecord(input)) throw new TypeError("Invalid Loops starter kit client input.");
  const baseUrl = rootUrl(input.baseUrl);
  const id = bounded(input.starterKitId, MAX_ID_LENGTH, "starter kit ID");
  const url = new URL(`/api/v1/starter-kits/details/${encodeURIComponent(id)}`, baseUrl);
  return client(url, input.authenticatedAccounts === true, input.transport, (body, observedAt) => loopsStarterKit(body, observedAt, baseUrl));
}

export function createRecommendationPixelfedStarterKitClient(
  input: RecommendationPixelfedStarterKitClientInput
): { read(input: RecommendationCuratedAccountSetReadInput): Promise<RecommendationCuratedAccountSet> } {
  if (!isRecord(input)) throw new TypeError("Invalid Pixelfed starter kit client input.");
  const documentUrl = safeUrl(input.documentUrl, "document URL");
  return client(documentUrl, input.authenticated === true, input.transport, (body, observedAt) =>
    pixelfedStarterKit(body, observedAt, documentUrl)
  );
}
