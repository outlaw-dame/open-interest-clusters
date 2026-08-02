import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS = [
  "mastodon_collection",
  "loops_starter_kit",
  "pixelfed_starter_kit"
] as const;
export type RecommendationCuratedAccountSetProvider = typeof RECOMMENDATION_CURATED_ACCOUNT_SET_PROVIDERS[number];

export type RecommendationCuratedAccountMembershipState =
  | "accepted"
  | "pending"
  | "rejected"
  | "revoked"
  | "unknown";

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
  trustBoundary: "same_provider" | "remote_provider";
  membershipComplete: boolean;
}

export interface RecommendationCuratedAccountSetTransportRequest {
  url: string;
  requiresAuthentication: boolean;
  signal?: AbortSignal;
}
export interface RecommendationCuratedAccountSetTransportResponse { body: unknown; observedAt: string }
export interface RecommendationCuratedAccountSetTransport {
  get(input: RecommendationCuratedAccountSetTransportRequest):
    | RecommendationCuratedAccountSetTransportResponse
    | Promise<RecommendationCuratedAccountSetTransportResponse>;
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

const MAX_URL = 2_048;
const MAX_ID = 512;
const MAX_NAME = 256;
const MAX_DESCRIPTION = 4_096;
const MAX_MEMBERS = 150;
const MEMBER_STATES = new Set<string>(["accepted", "pending", "rejected", "revoked", "unknown"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > maximum || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid curated account set ${label}.`);
  }
  return value;
}
function optionalText(value: unknown, maximum: number, label: string): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : text(value, maximum, label);
}
function httpsUrl(value: unknown, label: string): URL {
  const parsed = new URL(text(value, MAX_URL, label));
  const host = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  if (
    parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || host.length === 0 ||
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")
  ) throw new TypeError(`Invalid curated account set ${label}.`);
  parsed.hostname = host;
  parsed.hash = "";
  return parsed;
}
function baseUrl(value: unknown): URL {
  const parsed = httpsUrl(value, "base URL");
  if ((parsed.pathname !== "" && parsed.pathname !== "/") || parsed.search !== "") {
    throw new TypeError("Invalid curated account set base URL.");
  }
  parsed.pathname = "/";
  return parsed;
}
function date(value: unknown, label: string): string {
  const result = text(value, MAX_ID, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "curated-account-set", since: result });
  return result;
}
function authorize(value: unknown, subjectId: string, authenticated: boolean): void {
  if (!record(value) || value.status !== "authorized" || value.subjectId !== subjectId) {
    throw new TypeError("Invalid curated account set authorization.");
  }
  date(value.checkedAt, "authorization timestamp");
  if (typeof value.sourceVisibility !== "string" || typeof value.accessBasis !== "string") {
    throw new TypeError("Invalid curated account set authorization.");
  }
  if (authenticated && value.accessBasis !== "oauth_scope" && value.accessBasis !== "authenticated_api") {
    throw new TypeError("Curated account set requires authenticated authorization evidence.");
  }
  if (!authenticated && value.accessBasis === "unknown") {
    throw new TypeError("Curated account set requires public-read authorization evidence.");
  }
}
function tags(value: unknown): readonly string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const output = new Set<string>();
  for (const item of values) {
    const raw = record(item) ? item.name : item;
    if (typeof raw !== "string") continue;
    const normalized = (raw.startsWith("#") ? raw.slice(1) : raw).trim().toLocaleLowerCase("und");
    if (normalized.length > 0 && normalized.length <= 80 && !hasUnsafeControlCharacter(normalized)) output.add(normalized);
    if (output.size === 32) break;
  }
  return Object.freeze([...output]);
}
function membership(value: unknown): RecommendationCuratedAccountMembershipState {
  return typeof value === "string" && MEMBER_STATES.has(value)
    ? value as RecommendationCuratedAccountMembershipState
    : "unknown";
}
function account(id: unknown, uri: unknown, handle: unknown, state: unknown): RecommendationCuratedAccountMember {
  const result: RecommendationCuratedAccountMember = { accountId: text(id, MAX_ID, "member account ID"), state: membership(state) };
  const normalizedUri = optionalText(uri, MAX_URL, "member account URI");
  const normalizedHandle = optionalText(handle, MAX_ID, "member handle");
  if (normalizedUri !== undefined) result.accountUri = httpsUrl(normalizedUri, "member account URI").toString();
  if (normalizedHandle !== undefined) result.handle = normalizedHandle;
  return Object.freeze(result);
}
function freeze(input: RecommendationCuratedAccountSet): RecommendationCuratedAccountSet {
  if (input.members.length > MAX_MEMBERS) throw new TypeError("Invalid curated account set members.");
  return Object.freeze({ ...input, hashtags: Object.freeze([...input.hashtags]), members: Object.freeze([...input.members]) });
}
function commonOptional(input: RecommendationCuratedAccountSet, description: string | undefined, updatedAt: string | undefined): RecommendationCuratedAccountSet {
  const result: RecommendationCuratedAccountSet = { ...input };
  if (description !== undefined) result.description = description;
  if (updatedAt !== undefined) result.updatedAt = updatedAt;
  return result;
}

function parseMastodon(body: unknown, observedAt: string, origin: URL): RecommendationCuratedAccountSet {
  if (!record(body)) throw new TypeError("Invalid Mastodon collection response.");
  const collection = record(body.collection) ? body.collection : body;
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  if (!record(collection) || accounts.length > MAX_MEMBERS || accounts.some((item) => !record(item))) {
    throw new TypeError("Invalid Mastodon collection response.");
  }
  const states = new Map<string, unknown>();
  if (Array.isArray(collection.items)) for (const item of collection.items) {
    if (record(item) && typeof item.account_id === "string") states.set(item.account_id, item.state);
  }
  const curatorId = text(collection.account_id, MAX_ID, "curator ID");
  const resource = httpsUrl(collection.url ?? collection.uri, "resource URL");
  const members = accounts
    .filter((item) => item.id !== curatorId)
    .map((item) => account(item.id, item.url ?? item.uri, item.acct ?? item.username, states.get(String(item.id)) ?? "accepted"));
  return freeze(commonOptional({
    provider: "mastodon_collection", id: text(collection.id, MAX_ID, "ID"), url: resource.toString(), curatorId,
    name: text(collection.name, MAX_NAME, "name"), discoverable: collection.discoverable === true,
    sensitive: collection.sensitive === true, observedAt, hashtags: tags(collection.tag), members,
    trustBoundary: resource.origin === origin.origin ? "same_provider" : "remote_provider", membershipComplete: true
  }, optionalText(collection.description, MAX_DESCRIPTION, "description"),
  collection.updated_at === undefined ? undefined : date(collection.updated_at, "updated timestamp")));
}

function parseLoops(body: unknown, observedAt: string, origin: URL): RecommendationCuratedAccountSet {
  const value = record(body) && body.data !== undefined ? body.data : body;
  if (!record(value) || !record(value.creator)) throw new TypeError("Invalid Loops starter kit response.");
  const membersRaw = Array.isArray(value.accounts) ? value.accounts : [];
  if (membersRaw.length > MAX_MEMBERS || membersRaw.some((item) => !record(item))) throw new TypeError("Invalid Loops starter kit response.");
  const resource = httpsUrl(value.remote_url ?? value.url, "resource URL");
  const members = membersRaw.map((item) => account(
    item.id ?? item.profile_id, item.url ?? item.uri, item.username ?? item.acct,
    item.kit_status === 1 || item.status === "approved" ? "accepted" : item.status ?? "unknown"
  ));
  const result = commonOptional({
    provider: "loops_starter_kit", id: text(value.id, MAX_ID, "ID"), url: resource.toString(),
    curatorId: text(value.creator.id, MAX_ID, "curator ID"), name: text(value.title ?? value.name, MAX_NAME, "name"),
    discoverable: value.is_discoverable === true, sensitive: value.is_sensitive === true, observedAt,
    hashtags: tags(value.hashtags), members, trustBoundary: resource.origin === origin.origin ? "same_provider" : "remote_provider",
    membershipComplete: Array.isArray(value.accounts)
  }, optionalText(value.description, MAX_DESCRIPTION, "description"),
  value.updated_at === undefined ? undefined : date(value.updated_at, "updated timestamp"));
  const curatorUri = optionalText(value.creator.url ?? value.creator.uri, MAX_URL, "curator URI");
  if (curatorUri !== undefined) result.curatorUri = httpsUrl(curatorUri, "curator URI").toString();
  return freeze(result);
}

function parsePixelfed(body: unknown, observedAt: string, document: URL): RecommendationCuratedAccountSet {
  const value = record(body) && body.data !== undefined ? body.data : body;
  if (!record(value)) throw new TypeError("Invalid Pixelfed starter kit document.");
  const actions = Array.isArray(value.actions) ? value.actions : [];
  if (actions.length > 1_000 || actions.some((item) => !record(item))) throw new TypeError("Invalid Pixelfed starter kit document.");
  const members: RecommendationCuratedAccountMember[] = [];
  for (const action of actions) {
    if (action.type !== "Follow" && action.type !== "follow" && action.action !== "Follow" && action.action !== "follow") continue;
    const target = record(action.target) ? action.target : action;
    const id = target.id ?? target.account_id ?? target.url;
    if (id !== undefined) members.push(account(String(id), target.url ?? target.id, target.handle ?? target.acct, "accepted"));
    if (members.length > MAX_MEMBERS) throw new TypeError("Invalid Pixelfed starter kit document.");
  }
  const resource = httpsUrl(value.url ?? value.id ?? document.toString(), "resource URL");
  const curator = record(value.creator) ? value.creator : record(value.attributedTo) ? value.attributedTo : undefined;
  const curatorId = curator === undefined ? value.creator_id ?? value.attributedTo : curator.id ?? curator.url;
  const result = commonOptional({
    provider: "pixelfed_starter_kit", id: text(value.id ?? resource.toString(), MAX_URL, "ID"), url: resource.toString(),
    curatorId: text(curatorId, MAX_URL, "curator ID"), name: text(value.name ?? value.title, MAX_NAME, "name"),
    discoverable: value.discoverable !== false, sensitive: value.sensitive === true, observedAt,
    hashtags: tags(value.hashtags ?? value.tags), members,
    trustBoundary: resource.origin === document.origin ? "same_provider" : "remote_provider", membershipComplete: true
  }, optionalText(value.description ?? value.summary, MAX_DESCRIPTION, "description"),
  value.updated === undefined ? undefined : date(value.updated, "updated timestamp"));
  if (curator !== undefined && (curator.url !== undefined || curator.id !== undefined)) {
    result.curatorUri = httpsUrl(curator.url ?? curator.id, "curator URI").toString();
  }
  return freeze(result);
}

function makeClient(
  url: URL,
  authenticated: boolean,
  transport: RecommendationCuratedAccountSetTransport,
  parser: (body: unknown, observedAt: string) => RecommendationCuratedAccountSet
): { read(input: RecommendationCuratedAccountSetReadInput): Promise<RecommendationCuratedAccountSet> } {
  if (!record(transport) || typeof transport.get !== "function") throw new TypeError("Invalid curated account set transport.");
  return Object.freeze({
    async read(input) {
      if (!record(input)) throw new TypeError("Invalid curated account set read input.");
      const subjectId = text(input.subjectId, MAX_ID, "subject ID");
      authorize(input.authorization, subjectId, authenticated);
      const response = await transport.get({ url: url.toString(), requiresAuthentication: authenticated,
        ...(input.signal === undefined ? {} : { signal: input.signal }) });
      if (!record(response)) throw new TypeError("Invalid curated account set transport response.");
      return parser(response.body, date(response.observedAt, "observation timestamp"));
    }
  });
}

export function createRecommendationMastodonCollectionClient(input: RecommendationMastodonCollectionClientInput) {
  if (!record(input)) throw new TypeError("Invalid Mastodon collection client input.");
  const origin = baseUrl(input.baseUrl);
  const url = new URL(`/api/v1/collections/${encodeURIComponent(text(input.collectionId, MAX_ID, "collection ID"))}`, origin);
  return makeClient(url, input.authenticated === true, input.transport, (body, observedAt) => parseMastodon(body, observedAt, origin));
}
export function createRecommendationLoopsStarterKitClient(input: RecommendationLoopsStarterKitClientInput) {
  if (!record(input)) throw new TypeError("Invalid Loops starter kit client input.");
  const origin = baseUrl(input.baseUrl);
  const url = new URL(`/api/v1/starter-kits/details/${encodeURIComponent(text(input.starterKitId, MAX_ID, "starter kit ID"))}`, origin);
  return makeClient(url, input.authenticatedAccounts === true, input.transport, (body, observedAt) => parseLoops(body, observedAt, origin));
}
export function createRecommendationPixelfedStarterKitClient(input: RecommendationPixelfedStarterKitClientInput) {
  if (!record(input)) throw new TypeError("Invalid Pixelfed starter kit client input.");
  const document = httpsUrl(input.documentUrl, "document URL");
  return makeClient(document, input.authenticated === true, input.transport, (body, observedAt) => parsePixelfed(body, observedAt, document));
}
