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

export interface RecommendationAtprotoSubscribeLabelsTransportRequest {
  url: string;
  signal?: AbortSignal;
}

export interface RecommendationAtprotoSubscribeLabelsTransport {
  subscribe(input: RecommendationAtprotoSubscribeLabelsTransportRequest): AsyncIterable<unknown>;
}

export interface RecommendationAtprotoSubscribeLabelsInput {
  subjectId: string;
  labeler: RecommendationDiscoveredLabeler;
  subscription: RecommendationUserLabelerSubscriptionInput | RecommendationUserLabelerSubscription;
  cursor?: number;
  maxFrames?: number;
  maxLabels?: number;
  signal?: AbortSignal;
  onFrame?: (frame: RecommendationAtprotoSubscribeLabelsFrame) => void | Promise<void>;
}

export interface RecommendationAtprotoSubscribeLabelsFrame {
  seq: number;
  labels: readonly RecommendationAtprotoLabelSignal[];
}

export interface RecommendationAtprotoSubscribeLabelsInfo {
  name: string;
  message?: string;
}

export interface RecommendationAtprotoSubscribeLabelsResult {
  labels: readonly RecommendationAtprotoLabelSignal[];
  frames: number;
  lastCursor?: number;
  info?: RecommendationAtprotoSubscribeLabelsInfo;
  truncated: boolean;
}

const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_INFO_NAME_LENGTH = 128;
const MAX_INFO_MESSAGE_LENGTH = 2_048;
const MAX_LABELS_PER_FRAME = 1_000;
const MAX_FRAMES = 10_000;
const MAX_LABELS = 100_000;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
    throw new TypeError(`Invalid ATProto subscribeLabels ${label}.`);
  }
  return value;
}

function optionalBoundedString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, maxLength, label);
}

function normalizeDid(value: unknown, label: string): string {
  const normalized = boundedString(value, 256, label);
  if (!DID_PATTERN.test(normalized) || /\s/u.test(normalized)) {
    throw new TypeError(`Invalid ATProto subscribeLabels ${label}.`);
  }
  return normalized;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Invalid ATProto subscribeLabels ${label}.`);
  }
  return value;
}

function normalizeCursor(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ATProto subscribeLabels ${label}.`);
  }
  return value;
}

function encodeBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64_ALPHABET[(combined >>> 18) & 63];
    encoded += BASE64_ALPHABET[(combined >>> 12) & 63];
    encoded += second === undefined ? "=" : BASE64_ALPHABET[(combined >>> 6) & 63];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[combined & 63];
  }
  return encoded;
}

function normalizeStreamLabel(raw: Record<string, unknown>): Omit<RecommendationAtprotoLabelInput, "provenance"> {
  const normalized: Record<string, unknown> = { ...raw };
  if (raw.sig instanceof Uint8Array) {
    normalized.sig = encodeBase64(raw.sig);
  } else if (raw.sig !== undefined && typeof raw.sig !== "string") {
    throw new TypeError("Invalid ATProto subscribeLabels label signature.");
  }
  return normalized as unknown as Omit<RecommendationAtprotoLabelInput, "provenance">;
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return true;
  return host.includes(":");
}

function validateTrustBoundary(input: RecommendationAtprotoSubscribeLabelsInput): {
  labelerDid: string;
  endpoint: URL;
} {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ATProto subscribeLabels input.");
  const subjectId = boundedString(input.subjectId, MAX_SUBJECT_ID_LENGTH, "subject ID");
  if (!isPlainRecord(input.labeler) || input.labeler.requiresExplicitSubscription !== true) {
    throw new TypeError("Invalid ATProto subscribeLabels discovered labeler.");
  }

  const labelerDid = normalizeDid(input.labeler.labelerDid, "labeler DID");
  const endpointValue = boundedString(input.labeler.serviceEndpoint, MAX_ENDPOINT_LENGTH, "service endpoint");
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new TypeError("Invalid ATProto subscribeLabels service endpoint.");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    (endpoint.pathname !== "" && endpoint.pathname !== "/") ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    endpoint.hostname.length === 0 ||
    isUnsafeHost(endpoint.hostname)
  ) {
    throw new TypeError("Invalid ATProto subscribeLabels service endpoint.");
  }

  const subscription = normalizeRecommendationUserLabelerSubscription(input.subscription);
  if (subscription.subjectId !== subjectId || subscription.labelerDid !== labelerDid) {
    throw new TypeError("ATProto subscribeLabels requires a matching explicit subscription.");
  }
  if (subscription.revokedAt !== undefined) {
    throw new TypeError("ATProto subscribeLabels subscription has been revoked.");
  }

  return { labelerDid, endpoint };
}

function buildUrl(endpoint: URL, cursor: number | undefined): string {
  const url = new URL("/xrpc/com.atproto.label.subscribeLabels", endpoint);
  url.protocol = "wss:";
  if (cursor !== undefined) url.searchParams.set("cursor", String(cursor));
  return url.toString();
}

function normalizeInfo(value: Record<string, unknown>): RecommendationAtprotoSubscribeLabelsInfo {
  const name = boundedString(value.name, MAX_INFO_NAME_LENGTH, "info name");
  const message = optionalBoundedString(value.message, MAX_INFO_MESSAGE_LENGTH, "info message");
  const info: RecommendationAtprotoSubscribeLabelsInfo = { name };
  if (message !== undefined) info.message = message;
  return Object.freeze(info);
}

function normalizeFrame(
  value: Record<string, unknown>,
  expectedLabelerDid: string,
  previousSeq: number | undefined,
  remainingLabels: number
): RecommendationAtprotoSubscribeLabelsFrame {
  const seq = normalizeCursor(value.seq, "frame sequence");
  if (previousSeq !== undefined && seq <= previousSeq) {
    throw new TypeError("ATProto subscribeLabels frame sequence did not increase.");
  }
  if (!Array.isArray(value.labels) || value.labels.length > MAX_LABELS_PER_FRAME || value.labels.length > remainingLabels) {
    throw new TypeError("Invalid ATProto subscribeLabels label frame.");
  }

  const labels = value.labels.map((raw) => {
    if (!isPlainRecord(raw)) throw new TypeError("Invalid ATProto subscribeLabels label.");
    const normalized = normalizeRecommendationAtprotoLabel({
      ...normalizeStreamLabel(raw),
      provenance: "subscribe_labels"
    });
    if (normalized.labelerDid !== expectedLabelerDid) {
      throw new TypeError("ATProto subscribeLabels frame contained an unexpected labeler DID.");
    }
    return normalized;
  });

  return Object.freeze({ seq, labels: Object.freeze(labels) });
}

export function createRecommendationAtprotoSubscribeLabelsClient(
  transport: RecommendationAtprotoSubscribeLabelsTransport
): {
  consume(input: RecommendationAtprotoSubscribeLabelsInput): Promise<RecommendationAtprotoSubscribeLabelsResult>;
} {
  if (!isPlainRecord(transport) || typeof transport.subscribe !== "function") {
    throw new TypeError("Invalid ATProto subscribeLabels transport.");
  }

  async function consume(
    input: RecommendationAtprotoSubscribeLabelsInput
  ): Promise<RecommendationAtprotoSubscribeLabelsResult> {
    const boundary = validateTrustBoundary(input);
    const cursor = input.cursor === undefined ? undefined : normalizeCursor(input.cursor, "cursor");
    const maxFrames = positiveInteger(input.maxFrames, 1_000, MAX_FRAMES, "maximum frames");
    const maxLabels = positiveInteger(input.maxLabels, 10_000, MAX_LABELS, "maximum labels");
    if (input.onFrame !== undefined && typeof input.onFrame !== "function") {
      throw new TypeError("Invalid ATProto subscribeLabels frame handler.");
    }

    const request: RecommendationAtprotoSubscribeLabelsTransportRequest = {
      url: buildUrl(boundary.endpoint, cursor)
    };
    if (input.signal !== undefined) request.signal = input.signal;

    const stream = transport.subscribe(request);
    if (stream === null || typeof stream !== "object" || !(Symbol.asyncIterator in stream)) {
      throw new TypeError("Invalid ATProto subscribeLabels transport stream.");
    }

    const labels: RecommendationAtprotoLabelSignal[] = [];
    let frames = 0;
    let lastCursor = cursor;
    let info: RecommendationAtprotoSubscribeLabelsInfo | undefined;
    let truncated = false;

    for await (const raw of stream) {
      if (!isPlainRecord(raw)) throw new TypeError("Invalid ATProto subscribeLabels message.");
      if (Array.isArray(raw.labels)) {
        if (frames >= maxFrames || labels.length >= maxLabels) {
          truncated = true;
          break;
        }
        const frame = normalizeFrame(raw, boundary.labelerDid, lastCursor, maxLabels - labels.length);
        if (input.onFrame !== undefined) await input.onFrame(frame);
        labels.push(...frame.labels);
        frames += 1;
        lastCursor = frame.seq;
        continue;
      }

      if (raw.name !== undefined) {
        info = normalizeInfo(raw);
        break;
      }

      throw new TypeError("Invalid ATProto subscribeLabels message.");
    }

    const result: RecommendationAtprotoSubscribeLabelsResult = {
      labels: Object.freeze(labels),
      frames,
      truncated
    };
    if (lastCursor !== undefined) result.lastCursor = lastCursor;
    if (info !== undefined) result.info = info;
    return Object.freeze(result);
  }

  return Object.freeze({ consume });
}
