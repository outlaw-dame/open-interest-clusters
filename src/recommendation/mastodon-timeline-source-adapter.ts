import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationSourceVisibility
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  createMastodonProviderStatusSourceAdapter,
  type RecommendationMastodonProviderStatusSourceAdapterInput
} from "./protocol-provider-source-adapters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import {
  normalizeRecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult,
  type RecommendationSourceTrustBoundary
} from "./source-adapter.js";

export const RECOMMENDATION_MASTODON_TIMELINE_KINDS = ["public", "home", "list"] as const;
export type RecommendationMastodonTimelineKind = typeof RECOMMENDATION_MASTODON_TIMELINE_KINDS[number];

export interface RecommendationMastodonTimelineTransportRequest {
  url: string;
  requiresAuthentication: boolean;
  signal?: AbortSignal;
}

export interface RecommendationMastodonTimelineTransportResponse {
  body: unknown;
  observedAt: string;
  nextUrl?: string;
}

export interface RecommendationMastodonTimelineTransport {
  get(
    request: RecommendationMastodonTimelineTransportRequest
  ): RecommendationMastodonTimelineTransportResponse | Promise<RecommendationMastodonTimelineTransportResponse>;
}

export type RecommendationMastodonTimelineAuthorizer = (
  request: RecommendationSourceAdapterReadRequest,
  timeline: RecommendationMastodonTimelineKind
) => RecommendationProtocolSourceReadAuthorization | Promise<RecommendationProtocolSourceReadAuthorization>;

export interface RecommendationMastodonTimelineSourceAdapterInput {
  baseUrl: string;
  timeline: RecommendationMastodonTimelineKind;
  listId?: string;
  local?: boolean;
  remote?: boolean;
  maxStatusesPerRead?: number;
  signal?: AbortSignal;
  transport: RecommendationMastodonTimelineTransport;
  authorize: RecommendationMastodonTimelineAuthorizer;
  adapter?: Omit<
    RecommendationMastodonProviderStatusSourceAdapterInput,
    "read" | "maxRecordsPerRead" | "capabilities"
  >;
}

export type RecommendationMastodonTimelineSourceAdapter = Omit<RecommendationSourceAdapter, "read"> & {
  read(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult>;
};

const MAX_BASE_URL_LENGTH = 2_048;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_LIST_ID_LENGTH = 256;
const DEFAULT_MAX_STATUSES = 40;
const MAX_STATUSES = 40;
const TIMELINE_SET = new Set<string>(RECOMMENDATION_MASTODON_TIMELINE_KINDS);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);
const PUBLIC_ACCESS_BASES = new Set<RecommendationAccessBasis>([
  "public_web",
  "provider_policy",
  "authenticated_api",
  "oauth_scope"
]);
const PRIVATE_ACCESS_BASES = new Set<RecommendationAccessBasis>(["authenticated_api", "oauth_scope"]);
const ALLOWED_CURSOR_QUERY_PARAMETERS = new Set<string>([
  "limit",
  "max_id",
  "since_id",
  "min_id",
  "local",
  "remote",
  "only_media"
]);
const PUBLIC_CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_public",
  "supports_incremental_sync"
]);
const PRIVATE_CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_private_with_authorization",
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
    throw new TypeError(`Invalid Mastodon timeline ${label}.`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid Mastodon timeline ${label}.`);
  return value;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_STATUSES;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_STATUSES) {
    throw new TypeError("Invalid Mastodon timeline maximum statuses per read.");
  }
  return value;
}

function normalizeBaseUrl(value: unknown): URL {
  const raw = boundedString(value, MAX_BASE_URL_LENGTH, "base URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Invalid Mastodon timeline base URL.");
  }

  const normalizedHost = url.hostname.toLowerCase().replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    normalizedHost.length === 0 ||
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalizedHost) ||
    normalizedHost.includes(":")
  ) {
    throw new TypeError("Invalid Mastodon timeline base URL.");
  }

  url.hostname = normalizedHost;
  url.pathname = "/";
  return url;
}

function timelinePath(timeline: RecommendationMastodonTimelineKind, listId: string | undefined): string {
  if (timeline === "public") return "/api/v1/timelines/public";
  if (timeline === "home") return "/api/v1/timelines/home";
  if (listId === undefined) throw new TypeError("Mastodon list timeline requires a list ID.");
  return `/api/v1/timelines/list/${encodeURIComponent(listId)}`;
}

function normalizeTimeline(value: unknown): RecommendationMastodonTimelineKind {
  if (typeof value !== "string" || !TIMELINE_SET.has(value)) {
    throw new TypeError("Invalid Mastodon timeline kind.");
  }
  return value as RecommendationMastodonTimelineKind;
}

function normalizeAuthorizationBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid Mastodon timeline authorization ${label}.`);
  return value;
}

function validateAuthorization(
  value: unknown,
  request: RecommendationSourceAdapterReadRequest,
  timeline: RecommendationMastodonTimelineKind
): RecommendationProtocolSourceReadAuthorization {
  if (!isPlainRecord(value) || value.status !== "authorized" || value.subjectId !== request.subjectId) {
    throw new TypeError("Invalid Mastodon timeline authorization.");
  }

  const checkedAt = boundedString(value.checkedAt, MAX_CURSOR_LENGTH, "authorization timestamp");
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "mastodon-timeline-authorization", since: checkedAt });
  if (typeof value.sourceVisibility !== "string" || !VISIBILITY_SET.has(value.sourceVisibility)) {
    throw new TypeError("Invalid Mastodon timeline authorization visibility.");
  }
  if (typeof value.accessBasis !== "string" || !ACCESS_BASIS_SET.has(value.accessBasis)) {
    throw new TypeError("Invalid Mastodon timeline authorization access basis.");
  }

  const sourceVisibility = value.sourceVisibility as RecommendationSourceVisibility;
  const accessBasis = value.accessBasis as RecommendationAccessBasis;
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
    const normalized = normalizeAuthorizationBoolean(value[key], label);
    if (normalized !== undefined) authorization[key] = normalized;
  }

  if (timeline === "public") {
    if (sourceVisibility !== "public" || !PUBLIC_ACCESS_BASES.has(accessBasis)) {
      throw new TypeError("Mastodon public timeline requires public-read authorization evidence.");
    }
  } else if (authorization.containsPrivateData !== true || !PRIVATE_ACCESS_BASES.has(accessBasis)) {
    throw new TypeError("Mastodon private timeline requires explicit authenticated authorization evidence.");
  }

  return Object.freeze(authorization);
}

function buildInitialUrl(
  baseUrl: URL,
  path: string,
  timeline: RecommendationMastodonTimelineKind,
  limit: number,
  local: boolean | undefined,
  remote: boolean | undefined
): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set("limit", String(limit));
  if (timeline === "public") {
    if (local !== undefined) url.searchParams.set("local", String(local));
    if (remote !== undefined) url.searchParams.set("remote", String(remote));
  }
  return url.toString();
}

function requireCursorFilter(url: URL, key: "local" | "remote", expected: boolean | undefined): void {
  const values = url.searchParams.getAll(key);
  if (expected === undefined) {
    if (values.length !== 0) throw new TypeError("Invalid Mastodon timeline cursor.");
    return;
  }
  if (values.length !== 1 || values[0] !== String(expected)) {
    throw new TypeError("Invalid Mastodon timeline cursor.");
  }
}

function validateCursorUrl(
  cursor: unknown,
  baseUrl: URL,
  path: string,
  timeline: RecommendationMastodonTimelineKind,
  limit: number,
  local: boolean | undefined,
  remote: boolean | undefined
): string {
  const raw = boundedString(cursor, MAX_CURSOR_LENGTH, "cursor");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Invalid Mastodon timeline cursor.");
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== baseUrl.origin ||
    url.pathname !== path ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("Invalid Mastodon timeline cursor.");
  }

  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_CURSOR_QUERY_PARAMETERS.has(key)) {
      throw new TypeError("Invalid Mastodon timeline cursor.");
    }
  }

  const cursorLimitValues = url.searchParams.getAll("limit");
  if (cursorLimitValues.length > 1) throw new TypeError("Invalid Mastodon timeline cursor.");
  const cursorLimit = cursorLimitValues[0];
  if (cursorLimit !== undefined) {
    const parsed = Number.parseInt(cursorLimit, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > limit || String(parsed) !== cursorLimit) {
      throw new TypeError("Invalid Mastodon timeline cursor.");
    }
  } else {
    url.searchParams.set("limit", String(limit));
  }

  if (timeline === "public") {
    requireCursorFilter(url, "local", local);
    requireCursorFilter(url, "remote", remote);
  } else if (url.searchParams.has("local") || url.searchParams.has("remote")) {
    throw new TypeError("Invalid Mastodon timeline cursor.");
  }
  return url.toString();
}

function normalizeResponse(value: unknown, maximum: number): RecommendationMastodonTimelineTransportResponse & {
  body: readonly Record<string, unknown>[];
} {
  if (!isPlainRecord(value) || !Array.isArray(value.body) || value.body.length > maximum) {
    throw new TypeError("Invalid Mastodon timeline transport response.");
  }
  if (value.body.some((status) => !isPlainRecord(status))) {
    throw new TypeError("Invalid Mastodon timeline transport response.");
  }
  const observedAt = boundedString(value.observedAt, MAX_CURSOR_LENGTH, "observation timestamp");
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "mastodon-timeline-observation", since: observedAt });
  const response: RecommendationMastodonTimelineTransportResponse & { body: readonly Record<string, unknown>[] } = {
    body: Object.freeze([...value.body]) as readonly Record<string, unknown>[],
    observedAt
  };
  if (value.nextUrl !== undefined) response.nextUrl = boundedString(value.nextUrl, MAX_CURSOR_LENGTH, "next URL");
  return response;
}

function statusTrustBoundary(status: Record<string, unknown>, baseUrl: URL): RecommendationSourceTrustBoundary {
  const account = isPlainRecord(status.account) ? status.account : undefined;
  const actorUrl = account === undefined ? undefined : typeof account.url === "string" ? account.url : account.uri;
  if (typeof actorUrl !== "string") return "unknown";
  try {
    return new URL(actorUrl).origin === baseUrl.origin ? "same_provider" : "remote_provider";
  } catch {
    return "unknown";
  }
}

export function createRecommendationMastodonTimelineSourceAdapter(
  input: RecommendationMastodonTimelineSourceAdapterInput
): RecommendationMastodonTimelineSourceAdapter {
  if (!isPlainRecord(input) || !isPlainRecord(input.transport) || typeof input.transport.get !== "function" || typeof input.authorize !== "function") {
    throw new TypeError("Invalid Mastodon timeline source adapter input.");
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const timeline = normalizeTimeline(input.timeline);
  const listId = input.listId === undefined ? undefined : boundedString(input.listId, MAX_LIST_ID_LENGTH, "list ID");
  if (timeline !== "list" && listId !== undefined) throw new TypeError("Mastodon list ID is only valid for list timelines.");
  const local = optionalBoolean(input.local, "local flag");
  const remote = optionalBoolean(input.remote, "remote flag");
  if (timeline !== "public" && (local !== undefined || remote !== undefined)) {
    throw new TypeError("Mastodon local and remote flags are only valid for public timelines.");
  }
  if (local === true && remote === true) throw new TypeError("Mastodon public timeline cannot be both local-only and remote-only.");
  const maximum = normalizeLimit(input.maxStatusesPerRead);
  const path = timelinePath(timeline, listId);
  const capabilities = timeline === "public" ? PUBLIC_CAPABILITIES : PRIVATE_CAPABILITIES;

  return createMastodonProviderStatusSourceAdapter({
    ...(input.adapter ?? {}),
    capabilities,
    maxRecordsPerRead: maximum,
    recordDefaults: {
      containsThirdPartyData: true,
      serverSideProcessing: true,
      ...(input.adapter?.recordDefaults ?? {})
    },
    read: async (request) => {
      if (request.since !== undefined) {
        throw new TypeError("Mastodon timeline ingestion uses opaque pagination cursors, not timestamp-based since values.");
      }
      const authorization = validateAuthorization(await input.authorize(request, timeline), request, timeline);
      const requestedLimit = request.limit === undefined ? maximum : Math.min(request.limit, maximum);
      const url = request.cursor === undefined
        ? buildInitialUrl(baseUrl, path, timeline, requestedLimit, local, remote)
        : validateCursorUrl(request.cursor, baseUrl, path, timeline, requestedLimit, local, remote);
      const response = normalizeResponse(
        await input.transport.get({
          url,
          requiresAuthentication: timeline !== "public",
          ...(input.signal === undefined ? {} : { signal: input.signal })
        }),
        requestedLimit
      );
      const records = response.body.map((rawStatus) => ({
        rawStatus,
        observedAt: response.observedAt,
        trustBoundary: statusTrustBoundary(rawStatus, baseUrl),
        containsThirdPartyData: true,
        serverSideProcessing: true,
        ...(authorization.providerPolicyAllowsProcessing === undefined
          ? {}
          : { providerPolicyAllowsProcessing: authorization.providerPolicyAllowsProcessing })
      }));
      const result: {
        records: typeof records;
        authorization: RecommendationProtocolSourceReadAuthorization;
        cursor?: string;
      } = { records, authorization };
      if (response.nextUrl !== undefined) {
        result.cursor = validateCursorUrl(response.nextUrl, baseUrl, path, timeline, requestedLimit, local, remote);
      }
      return result;
    }
  }) as RecommendationMastodonTimelineSourceAdapter;
}
