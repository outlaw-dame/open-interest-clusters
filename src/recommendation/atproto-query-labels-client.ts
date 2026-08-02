import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  normalizeRecommendationAtprotoLabel,
  type RecommendationAtprotoLabelInput,
  type RecommendationAtprotoLabelSignal
} from "./atproto-labels.js";
import type { RecommendationDiscoveredLabeler } from "./labeler-discovery.js";
import {
  normalizeRecommendationUserLabelerSubscription,
  type RecommendationUserLabelerSubscription,
  type RecommendationUserLabelerSubscriptionInput
} from "./labeler-signal-policy.js";

export interface RecommendationAtprotoQueryLabelsTransportRequest {
  url: string;
  signal?: AbortSignal;
}

export interface RecommendationAtprotoQueryLabelsTransportResponse {
  status: number;
  body: unknown;
}

export interface RecommendationAtprotoQueryLabelsTransport {
  request(input: RecommendationAtprotoQueryLabelsTransportRequest): Promise<RecommendationAtprotoQueryLabelsTransportResponse>;
}

export interface RecommendationAtprotoQueryLabelsInput {
  subjectId: string;
  labeler: RecommendationDiscoveredLabeler;
  subscription: RecommendationUserLabelerSubscriptionInput | RecommendationUserLabelerSubscription;
  uriPatterns?: readonly string[];
  sources?: readonly string[];
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface RecommendationAtprotoQueryLabelsPage {
  labels: readonly RecommendationAtprotoLabelSignal[];
  cursor?: string;
}

export interface RecommendationAtprotoQueryLabelsAllInput extends RecommendationAtprotoQueryLabelsInput {
  maxPages?: number;
  maxLabels?: number;
}

export interface RecommendationAtprotoQueryLabelsResult {
  labels: readonly RecommendationAtprotoLabelSignal[];
  pages: number;
  nextCursor?: string;
  truncated: boolean;
}

const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_URI_PATTERN_LENGTH = 2_048;
const MAX_URI_PATTERNS = 100;
const MAX_SOURCES = 20;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_PAGE_LIMIT = 250;
const MAX_PAGES = 100;
const MAX_LABELS = 10_000;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid ATProto queryLabels ${label}.`);
  }
  return value;
}

function normalizeDid(value: unknown, label: string): string {
  const normalized = boundedString(value, 256, label);
  if (!DID_PATTERN.test(normalized) || /\s/u.test(normalized)) {
    throw new TypeError(`Invalid ATProto queryLabels ${label}.`);
  }
  return normalized;
}

function normalizeStringList(
  value: readonly string[] | undefined,
  maximum: number,
  label: string,
  normalizer: (item: unknown) => string
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`Invalid ATProto queryLabels ${label}.`);
  }
  return Object.freeze([...new Set(value.map((item) => normalizer(item)))].sort());
}

function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Invalid ATProto queryLabels ${label}.`);
  }
  return value;
}

function validateTrustBoundary(input: RecommendationAtprotoQueryLabelsInput): {
  labelerDid: string;
  endpoint: string;
} {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ATProto queryLabels input.");
  const subjectId = boundedString(input.subjectId, MAX_SUBJECT_ID_LENGTH, "subject ID");
  if (!isPlainRecord(input.labeler) || input.labeler.requiresExplicitSubscription !== true) {
    throw new TypeError("Invalid ATProto queryLabels discovered labeler.");
  }
  const labelerDid = normalizeDid(input.labeler.labelerDid, "labeler DID");
  const endpoint = boundedString(input.labeler.serviceEndpoint, 2_048, "service endpoint");
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("Invalid ATProto queryLabels service endpoint.");
  }
  const subscription = normalizeRecommendationUserLabelerSubscription(input.subscription);
  if (subscription.subjectId !== subjectId || subscription.labelerDid !== labelerDid) {
    throw new TypeError("ATProto queryLabels requires a matching explicit subscription.");
  }
  if (subscription.revokedAt !== undefined) {
    throw new TypeError("ATProto queryLabels subscription has been revoked.");
  }
  return { labelerDid, endpoint };
}

function buildUrl(input: RecommendationAtprotoQueryLabelsInput, endpoint: string): string {
  const uriPatterns = normalizeStringList(
    input.uriPatterns,
    MAX_URI_PATTERNS,
    "URI patterns",
    (item) => boundedString(item, MAX_URI_PATTERN_LENGTH, "URI pattern")
  );
  const sources = normalizeStringList(
    input.sources,
    MAX_SOURCES,
    "sources",
    (item) => normalizeDid(item, "source DID")
  );
  const limit = positiveInteger(input.limit, 100, MAX_PAGE_LIMIT, "limit");
  const cursor = input.cursor === undefined ? undefined : boundedString(input.cursor, MAX_CURSOR_LENGTH, "cursor");
  const url = new URL("/xrpc/com.atproto.label.queryLabels", endpoint);
  for (const pattern of uriPatterns) url.searchParams.append("uriPatterns", pattern);
  for (const source of sources) url.searchParams.append("sources", source);
  url.searchParams.set("limit", String(limit));
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  return url.toString();
}

function parsePage(body: unknown, expectedLabelerDid: string): RecommendationAtprotoQueryLabelsPage {
  if (!isPlainRecord(body) || !Array.isArray(body.labels) || body.labels.length > MAX_PAGE_LIMIT) {
    throw new TypeError("Invalid ATProto queryLabels response.");
  }
  const labels = body.labels.map((raw) => {
    if (!isPlainRecord(raw)) throw new TypeError("Invalid ATProto queryLabels label.");
    const normalized = normalizeRecommendationAtprotoLabel({
      ...(raw as unknown as Omit<RecommendationAtprotoLabelInput, "provenance">),
      provenance: "query_labels"
    });
    if (normalized.labelerDid !== expectedLabelerDid) {
      throw new TypeError("ATProto queryLabels response contained an unexpected labeler DID.");
    }
    return normalized;
  });
  const cursor = body.cursor === undefined ? undefined : boundedString(body.cursor, MAX_CURSOR_LENGTH, "response cursor");
  const page: RecommendationAtprotoQueryLabelsPage = { labels: Object.freeze(labels) };
  if (cursor !== undefined) page.cursor = cursor;
  return Object.freeze(page);
}

export function createRecommendationAtprotoQueryLabelsClient(transport: RecommendationAtprotoQueryLabelsTransport): {
  queryPage(input: RecommendationAtprotoQueryLabelsInput): Promise<RecommendationAtprotoQueryLabelsPage>;
  queryAll(input: RecommendationAtprotoQueryLabelsAllInput): Promise<RecommendationAtprotoQueryLabelsResult>;
} {
  if (!isPlainRecord(transport) || typeof transport.request !== "function") {
    throw new TypeError("Invalid ATProto queryLabels transport.");
  }

  async function queryPage(input: RecommendationAtprotoQueryLabelsInput): Promise<RecommendationAtprotoQueryLabelsPage> {
    const boundary = validateTrustBoundary(input);
    const request: RecommendationAtprotoQueryLabelsTransportRequest = {
      url: buildUrl(input, boundary.endpoint)
    };
    if (input.signal !== undefined) request.signal = input.signal;
    const response = await transport.request(request);
    if (!isPlainRecord(response) || response.status !== 200) {
      throw new Error("ATProto queryLabels request failed.");
    }
    return parsePage(response.body, boundary.labelerDid);
  }

  async function queryAll(input: RecommendationAtprotoQueryLabelsAllInput): Promise<RecommendationAtprotoQueryLabelsResult> {
    const maxPages = positiveInteger(input.maxPages, 20, MAX_PAGES, "maximum pages");
    const maxLabels = positiveInteger(input.maxLabels, 2_000, MAX_LABELS, "maximum labels");
    const labels: RecommendationAtprotoLabelSignal[] = [];
    const seenCursors = new Set<string>();
    let cursor = input.cursor;
    let pages = 0;
    let truncated = false;

    while (pages < maxPages && labels.length < maxLabels) {
      const pageInput: RecommendationAtprotoQueryLabelsInput = {
        subjectId: input.subjectId,
        labeler: input.labeler,
        subscription: input.subscription
      };
      if (input.uriPatterns !== undefined) pageInput.uriPatterns = input.uriPatterns;
      if (input.sources !== undefined) pageInput.sources = input.sources;
      if (input.limit !== undefined) pageInput.limit = input.limit;
      if (input.signal !== undefined) pageInput.signal = input.signal;
      if (cursor !== undefined) pageInput.cursor = cursor;
      const page = await queryPage(pageInput);
      pages += 1;
      const remaining = maxLabels - labels.length;
      labels.push(...page.labels.slice(0, remaining));
      if (page.labels.length > remaining) {
        truncated = true;
        cursor = page.cursor;
        break;
      }
      if (page.cursor === undefined) {
        cursor = undefined;
        break;
      }
      if (seenCursors.has(page.cursor)) {
        throw new Error("ATProto queryLabels pagination cursor repeated.");
      }
      seenCursors.add(page.cursor);
      cursor = page.cursor;
    }

    if (cursor !== undefined && (pages >= maxPages || labels.length >= maxLabels)) truncated = true;
    const result: RecommendationAtprotoQueryLabelsResult = {
      labels: Object.freeze(labels),
      pages,
      truncated
    };
    if (cursor !== undefined) result.nextCursor = cursor;
    return Object.freeze(result);
  }

  return Object.freeze({ queryPage, queryAll });
}
