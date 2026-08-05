import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationSourceVisibility
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  createActivityPubProviderActivitySourceAdapter,
  type RecommendationActivityPubProviderActivitySourceAdapterInput
} from "./protocol-provider-source-adapters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import {
  normalizeRecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult
} from "./source-adapter.js";

export interface RecommendationActivityPubOutboxTransportRequest {
  url: string;
  signal?: AbortSignal;
}

export interface RecommendationActivityPubOutboxTransportResponse {
  body: unknown;
  observedAt: string;
}

export interface RecommendationActivityPubOutboxTransport {
  get(
    request: RecommendationActivityPubOutboxTransportRequest
  ): RecommendationActivityPubOutboxTransportResponse | Promise<RecommendationActivityPubOutboxTransportResponse>;
}

export type RecommendationActivityPubOutboxAuthorizer = (
  request: RecommendationSourceAdapterReadRequest,
  actorUrl: string
) => RecommendationProtocolSourceReadAuthorization | Promise<RecommendationProtocolSourceReadAuthorization>;

export interface RecommendationActivityPubPublicOutboxSourceAdapterInput {
  actorUrl: string;
  maxActivitiesPerRead?: number;
  maxPagesPerRead?: number;
  maxItemsPerPage?: number;
  signal?: AbortSignal;
  transport: RecommendationActivityPubOutboxTransport;
  authorize: RecommendationActivityPubOutboxAuthorizer;
  adapter?: Omit<
    RecommendationActivityPubProviderActivitySourceAdapterInput,
    "read" | "maxRecordsPerRead" | "capabilities"
  >;
}

export type RecommendationActivityPubPublicOutboxSourceAdapter = Omit<RecommendationSourceAdapter, "read"> & {
  read(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult>;
};

const MAX_URL_LENGTH = 4_096;
const MAX_CURSOR_LENGTH = 8_192;
const DEFAULT_MAX_ACTIVITIES = 100;
const MAX_ACTIVITIES = 500;
const DEFAULT_MAX_PAGES = 8;
const MAX_PAGES = 32;
const DEFAULT_MAX_ITEMS_PER_PAGE = 200;
const MAX_ITEMS_PER_PAGE = 500;
const CURSOR_PREFIX = "activitypub-outbox:v1:";
const PUBLIC_RECIPIENTS = new Set<string>([
  "https://www.w3.org/ns/activitystreams#Public",
  "as:Public",
  "Public"
]);
const COLLECTION_TYPES = new Set<string>([
  "Collection",
  "OrderedCollection",
  "CollectionPage",
  "OrderedCollectionPage"
]);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);
const PUBLIC_ACCESS_BASES = new Set<RecommendationAccessBasis>([
  "public_web",
  "provider_policy",
  "authenticated_api",
  "oauth_scope"
]);
const CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_public",
  "supports_incremental_sync"
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid ActivityPub outbox ${label}.`);
  }
  return value;
}

function normalizePositiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Invalid ActivityPub outbox ${label}.`);
  }
  return value;
}

function normalizePublicUrl(value: unknown, label: string, expectedOrigin?: string): URL {
  const raw = boundedString(value, MAX_URL_LENGTH, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ActivityPub outbox ${label}.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.includes(":") ||
    (expectedOrigin !== undefined && url.origin !== expectedOrigin)
  ) {
    throw new TypeError(`Invalid ActivityPub outbox ${label}.`);
  }
  url.hostname = hostname;
  return url;
}

function normalizeTimestamp(value: unknown, label: string): string {
  const timestamp = boundedString(value, MAX_URL_LENGTH, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypub-outbox", since: timestamp });
  return timestamp;
}

function optionalAuthorizationBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid ActivityPub outbox authorization ${label}.`);
  return value;
}

function validateAuthorization(
  value: unknown,
  request: RecommendationSourceAdapterReadRequest
): RecommendationProtocolSourceReadAuthorization {
  if (!isPlainRecord(value) || value.status !== "authorized" || value.subjectId !== request.subjectId) {
    throw new TypeError("Invalid ActivityPub outbox authorization.");
  }
  const checkedAt = normalizeTimestamp(value.checkedAt, "authorization timestamp");
  if (typeof value.sourceVisibility !== "string" || !VISIBILITY_SET.has(value.sourceVisibility)) {
    throw new TypeError("Invalid ActivityPub outbox authorization visibility.");
  }
  if (typeof value.accessBasis !== "string" || !ACCESS_BASIS_SET.has(value.accessBasis)) {
    throw new TypeError("Invalid ActivityPub outbox authorization access basis.");
  }
  const sourceVisibility = value.sourceVisibility as RecommendationSourceVisibility;
  const accessBasis = value.accessBasis as RecommendationAccessBasis;
  if (sourceVisibility !== "public" || !PUBLIC_ACCESS_BASES.has(accessBasis)) {
    throw new TypeError("ActivityPub outbox ingestion requires explicit public-read authorization evidence.");
  }
  const authorization: RecommendationProtocolSourceReadAuthorization = {
    status: "authorized",
    subjectId: request.subjectId,
    checkedAt,
    sourceVisibility,
    accessBasis
  };
  for (const [key, label] of [
    ["containsPrivateData", "private-data flag"],
    ["containsThirdPartyData", "third-party-data flag"],
    ["serverSideProcessing", "server-processing flag"],
    ["providerPolicyAllowsProcessing", "provider-policy flag"]
  ] as const) {
    const normalized = optionalAuthorizationBoolean(value[key], label);
    if (normalized !== undefined) authorization[key] = normalized;
  }
  if (authorization.containsPrivateData === true) {
    throw new TypeError("ActivityPub outbox ingestion does not permit private source data.");
  }
  return Object.freeze(authorization);
}

function response(value: unknown): RecommendationActivityPubOutboxTransportResponse & { body: Record<string, unknown> } {
  if (!isPlainRecord(value) || !isPlainRecord(value.body)) {
    throw new TypeError("Invalid ActivityPub outbox transport response.");
  }
  return {
    body: value.body,
    observedAt: normalizeTimestamp(value.observedAt, "observation timestamp")
  };
}

function idFromLink(value: unknown, label: string): string {
  if (typeof value === "string") return boundedString(value, MAX_URL_LENGTH, label);
  if (isPlainRecord(value) && typeof value.id === "string") return boundedString(value.id, MAX_URL_LENGTH, label);
  throw new TypeError(`Invalid ActivityPub outbox ${label}.`);
}

function typeValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function requireCollection(value: Record<string, unknown>): void {
  if (!typeValues(value.type).some((type) => COLLECTION_TYPES.has(type))) {
    throw new TypeError("Invalid ActivityPub outbox collection type.");
  }
}

function collectionItems(value: Record<string, unknown>, maximum: number): readonly Record<string, unknown>[] {
  const ordered = value.orderedItems;
  const unordered = value.items;
  if (ordered !== undefined && unordered !== undefined) {
    throw new TypeError("Ambiguous ActivityPub outbox collection items.");
  }
  const raw = ordered ?? unordered ?? [];
  if (!Array.isArray(raw) || raw.length > maximum || raw.some((item) => !isPlainRecord(item))) {
    throw new TypeError("Invalid ActivityPub outbox collection items.");
  }
  return Object.freeze([...raw]) as readonly Record<string, unknown>[];
}

function publicRecipient(value: unknown): boolean {
  if (typeof value === "string") return PUBLIC_RECIPIENTS.has(value);
  if (isPlainRecord(value) && typeof value.id === "string") return PUBLIC_RECIPIENTS.has(value.id);
  if (Array.isArray(value)) return value.some(publicRecipient);
  return false;
}

function isExplicitlyPublic(activity: Record<string, unknown>): boolean {
  if (publicRecipient(activity.to) || publicRecipient(activity.cc) || publicRecipient(activity.audience)) return true;
  const object = isPlainRecord(activity.object) ? activity.object : undefined;
  return object !== undefined && (publicRecipient(object.to) || publicRecipient(object.cc) || publicRecipient(object.audience));
}

function activityActor(activity: Record<string, unknown>): string {
  return idFromLink(activity.actor, "activity actor");
}

function nextLink(value: Record<string, unknown>, origin: string): string | undefined {
  if (value.next === undefined || value.next === null) return undefined;
  return normalizePublicUrl(idFromLink(value.next, "next page"), "next page", origin).toString();
}

interface CursorState {
  pageUrl: string;
  offset: number;
}

function encodeCursor(state: CursorState): string {
  const cursor = `${CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(state))}`;
  if (cursor.length > MAX_CURSOR_LENGTH) throw new TypeError("ActivityPub outbox cursor exceeds the maximum length.");
  return cursor;
}

function decodeCursor(value: unknown, origin: string): CursorState {
  const cursor = boundedString(value, MAX_CURSOR_LENGTH, "cursor");
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new TypeError("Invalid ActivityPub outbox cursor.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(cursor.slice(CURSOR_PREFIX.length)));
  } catch {
    throw new TypeError("Invalid ActivityPub outbox cursor.");
  }
  if (!isPlainRecord(parsed) || typeof parsed.offset !== "number" || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) {
    throw new TypeError("Invalid ActivityPub outbox cursor.");
  }
  return {
    pageUrl: normalizePublicUrl(parsed.pageUrl, "cursor page URL", origin).toString(),
    offset: parsed.offset
  };
}

function actorDocument(value: Record<string, unknown>, actorUrl: string, origin: string): string {
  const id = normalizePublicUrl(value.id, "actor ID", origin).toString();
  if (id !== actorUrl) throw new TypeError("ActivityPub actor identity mismatch.");
  return normalizePublicUrl(idFromLink(value.outbox, "actor outbox"), "actor outbox", origin).toString();
}

export function createRecommendationActivityPubPublicOutboxSourceAdapter(
  input: RecommendationActivityPubPublicOutboxSourceAdapterInput
): RecommendationActivityPubPublicOutboxSourceAdapter {
  if (!isPlainRecord(input) || !isPlainRecord(input.transport) || typeof input.transport.get !== "function" || typeof input.authorize !== "function") {
    throw new TypeError("Invalid ActivityPub public outbox source adapter input.");
  }
  const actorUrl = normalizePublicUrl(input.actorUrl, "actor URL").toString();
  const origin = new URL(actorUrl).origin;
  const maximumActivities = normalizePositiveInteger(input.maxActivitiesPerRead, DEFAULT_MAX_ACTIVITIES, MAX_ACTIVITIES, "maximum activities per read");
  const maximumPages = normalizePositiveInteger(input.maxPagesPerRead, DEFAULT_MAX_PAGES, MAX_PAGES, "maximum pages per read");
  const maximumItemsPerPage = normalizePositiveInteger(input.maxItemsPerPage, DEFAULT_MAX_ITEMS_PER_PAGE, MAX_ITEMS_PER_PAGE, "maximum items per page");

  return createActivityPubProviderActivitySourceAdapter({
    ...(input.adapter ?? {}),
    capabilities: CAPABILITIES,
    maxRecordsPerRead: maximumActivities,
    recordDefaults: {
      containsThirdPartyData: true,
      serverSideProcessing: true,
      ...(input.adapter?.recordDefaults ?? {})
    },
    read: async (request) => {
      if (request.since !== undefined) {
        throw new TypeError("ActivityPub outbox ingestion uses opaque cursors, not timestamp-based since values.");
      }
      const authorization = validateAuthorization(await input.authorize(request, actorUrl), request);
      const actorResponse = response(await input.transport.get({
        url: actorUrl,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      }));
      const outboxUrl = actorDocument(actorResponse.body, actorUrl, origin);
      const cursorState = request.cursor === undefined ? { pageUrl: outboxUrl, offset: 0 } : decodeCursor(request.cursor, origin);
      const requestedLimit = request.limit === undefined ? maximumActivities : Math.min(request.limit, maximumActivities);
      const visited = new Set<string>();
      const records: Array<{
        rawActivity: Record<string, unknown>;
        observedAt: string;
        fallbackActorUri: string;
        fallbackVisibility: "public";
        trustBoundary: "same_provider";
        containsThirdPartyData: true;
        serverSideProcessing: true;
      }> = [];
      let pageUrl: string | undefined = cursorState.pageUrl;
      let offset = cursorState.offset;
      let pages = 0;
      let nextCursor: string | undefined;

      while (pageUrl !== undefined && pages < maximumPages && records.length < requestedLimit) {
        if (visited.has(pageUrl)) throw new TypeError("ActivityPub outbox pagination cycle detected.");
        visited.add(pageUrl);
        pages += 1;
        const pageResponse = response(await input.transport.get({
          url: pageUrl,
          ...(input.signal === undefined ? {} : { signal: input.signal })
        }));
        requireCollection(pageResponse.body);
        if (pageResponse.body.id !== undefined) {
          const pageId = normalizePublicUrl(idFromLink(pageResponse.body.id, "collection ID"), "collection ID", origin).toString();
          if (pageId !== pageUrl) throw new TypeError("ActivityPub outbox collection identity mismatch.");
        }
        const items = collectionItems(pageResponse.body, maximumItemsPerPage);
        if (offset > items.length) throw new TypeError("Invalid ActivityPub outbox cursor offset.");

        for (let index = offset; index < items.length; index += 1) {
          const activity = items[index];
          if (activity === undefined) continue;
          if (activityActor(activity) !== actorUrl) throw new TypeError("ActivityPub outbox activity actor mismatch.");
          if (isExplicitlyPublic(activity)) {
            records.push({
              rawActivity: activity,
              observedAt: pageResponse.observedAt,
              fallbackActorUri: actorUrl,
              fallbackVisibility: "public",
              trustBoundary: "same_provider",
              containsThirdPartyData: true,
              serverSideProcessing: true
            });
          }
          if (records.length >= requestedLimit) {
            const followingOffset = index + 1;
            if (followingOffset < items.length) nextCursor = encodeCursor({ pageUrl, offset: followingOffset });
            else {
              const next = nextLink(pageResponse.body, origin);
              if (next !== undefined) nextCursor = encodeCursor({ pageUrl: next, offset: 0 });
            }
            break;
          }
        }
        if (records.length >= requestedLimit) break;
        offset = 0;
        pageUrl = nextLink(pageResponse.body, origin);
      }

      if (records.length < requestedLimit && pageUrl !== undefined && pages >= maximumPages) {
        nextCursor = encodeCursor({ pageUrl, offset });
      }
      const result: {
        records: readonly typeof records[number][];
        authorization: RecommendationProtocolSourceReadAuthorization;
        cursor?: string;
      } = {
        records: Object.freeze(records),
        authorization
      };
      if (nextCursor !== undefined) result.cursor = nextCursor;
      return Object.freeze(result);
    }
  }) as RecommendationActivityPubPublicOutboxSourceAdapter;
}
