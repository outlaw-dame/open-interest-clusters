import { hasUnsafeControlCharacter } from "./control-characters.js";

export const RECOMMENDATION_ATPROTO_LABEL_PROVENANCES = [
  "hydrated_response",
  "query_labels",
  "subscribe_labels",
  "self_label"
] as const;

export type RecommendationAtprotoLabelProvenance = typeof RECOMMENDATION_ATPROTO_LABEL_PROVENANCES[number];

export interface RecommendationAtprotoLabelInput {
  src: string;
  uri: string;
  val: string;
  cts: string;
  cid?: string;
  neg?: boolean;
  exp?: string;
  sig?: string;
  ver?: number;
  provenance: RecommendationAtprotoLabelProvenance;
}

export interface RecommendationAtprotoLabelSignal {
  labelerDid: string;
  targetUri: string;
  value: string;
  createdAt: string;
  provenance: RecommendationAtprotoLabelProvenance;
  negated: boolean;
  targetCid?: string;
  expiresAt?: string;
  signature?: string;
  version?: number;
}

export type RecommendationAtprotoLabelStateValue = RecommendationAtprotoLabelInput | RecommendationAtprotoLabelSignal;

export interface RecommendationAtprotoLabelStateInput {
  existing?: RecommendationAtprotoLabelStateValue;
  incoming: RecommendationAtprotoLabelStateValue;
  now?: string;
}

const MAX_ATPROTO_LABEL_DID_LENGTH = 256;
const MAX_ATPROTO_LABEL_URI_LENGTH = 2_048;
const MAX_ATPROTO_LABEL_CID_LENGTH = 256;
const MAX_ATPROTO_LABEL_VALUE_LENGTH = 128;
const MAX_ATPROTO_LABEL_SIGNATURE_LENGTH = 2_048;
const MAX_ATPROTO_LABEL_TIMESTAMP_LENGTH = 64;
const MIN_ATPROTO_LABEL_VERSION = 1;
const MAX_ATPROTO_LABEL_VERSION = 1_000_000;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const LABEL_VALUE_PATTERN = /^!?[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:+=/%-]*$/u;
const RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;
const PROVENANCE_SET = new Set<string>(RECOMMENDATION_ATPROTO_LABEL_PROVENANCES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !hasUnsafeControlCharacter(value)
  );
}

function requiredString(value: unknown, maxLength: number, label: string): string {
  if (!isBoundedString(value, maxLength)) {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  return value;
}

function optionalString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, maxLength, label);
}

function normalizeDid(value: unknown, label: string): string {
  const did = requiredString(value, MAX_ATPROTO_LABEL_DID_LENGTH, label);
  if (!DID_PATTERN.test(did) || hasWhitespace(did)) {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  return did;
}

function normalizeUri(value: unknown): string {
  const uri = requiredString(value, MAX_ATPROTO_LABEL_URI_LENGTH, "target URI");
  if (!URI_SCHEME_PATTERN.test(uri) || hasWhitespace(uri)) {
    throw new TypeError("Invalid ATProto label target URI.");
  }

  return uri;
}

function normalizeOptionalCid(value: unknown): string | undefined {
  const cid = optionalString(value, MAX_ATPROTO_LABEL_CID_LENGTH, "target CID");
  if (cid === undefined) return undefined;
  if (!SAFE_TOKEN_PATTERN.test(cid) || hasWhitespace(cid)) {
    throw new TypeError("Invalid ATProto label target CID.");
  }

  return cid;
}

function normalizeLabelValue(value: unknown): string {
  const label = requiredString(value, MAX_ATPROTO_LABEL_VALUE_LENGTH, "value");
  if (!LABEL_VALUE_PATTERN.test(label)) {
    throw new TypeError("Invalid ATProto label value.");
  }

  return label;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function normalizeTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, MAX_ATPROTO_LABEL_TIMESTAMP_LENGTH, label);
  const match = RFC3339_TIMESTAMP_PATTERN.exec(timestamp);
  if (match === null) {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "", 10);
  const zone = match[7] ?? "";

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  if (zone !== "Z") {
    const offsetHour = Number.parseInt(zone.slice(1, 3), 10);
    const offsetMinute = Number.parseInt(zone.slice(4, 6), 10);
    if (offsetHour > 23 || offsetMinute > 59) {
      throw new TypeError(`Invalid ATProto label ${label}.`);
    }
  }

  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  return timestamp;
}

function normalizeOptionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeTimestamp(value, label);
}

function normalizeOptionalSignature(value: unknown): string | undefined {
  const signature = optionalString(value, MAX_ATPROTO_LABEL_SIGNATURE_LENGTH, "signature");
  if (signature === undefined) return undefined;
  if (hasWhitespace(signature)) {
    throw new TypeError("Invalid ATProto label signature.");
  }

  return signature;
}

function normalizeOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`Invalid ATProto label ${label}.`);
  }

  return value;
}

function normalizeOptionalVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_ATPROTO_LABEL_VERSION ||
    value > MAX_ATPROTO_LABEL_VERSION
  ) {
    throw new TypeError("Invalid ATProto label version.");
  }

  return value;
}

function normalizeProvenance(value: unknown): RecommendationAtprotoLabelProvenance {
  if (typeof value !== "string" || !PROVENANCE_SET.has(value)) {
    throw new TypeError("Invalid ATProto label provenance.");
  }

  return value as RecommendationAtprotoLabelProvenance;
}

function compareTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    throw new TypeError("Invalid ATProto label timestamp comparison.");
  }

  return leftMs - rightMs;
}

function isNormalizedLabelSignal(value: unknown): value is RecommendationAtprotoLabelSignal {
  return isPlainRecord(value) && "labelerDid" in value && "targetUri" in value && "value" in value && "createdAt" in value;
}

function normalizeRecommendationAtprotoLabelSignal(input: RecommendationAtprotoLabelSignal): RecommendationAtprotoLabelSignal {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid ATProto label signal input.");
  }

  const signal: RecommendationAtprotoLabelSignal = {
    labelerDid: normalizeDid(input.labelerDid, "source DID"),
    targetUri: normalizeUri(input.targetUri),
    value: normalizeLabelValue(input.value),
    createdAt: normalizeTimestamp(input.createdAt, "creation timestamp"),
    provenance: normalizeProvenance(input.provenance),
    negated: normalizeOptionalBoolean(input.negated, "negation flag") ?? false
  };

  const targetCid = normalizeOptionalCid(input.targetCid);
  const expiresAt = normalizeOptionalTimestamp(input.expiresAt, "expiration timestamp");
  const signature = normalizeOptionalSignature(input.signature);
  const version = normalizeOptionalVersion(input.version);

  if (targetCid !== undefined) signal.targetCid = targetCid;
  if (expiresAt !== undefined) signal.expiresAt = expiresAt;
  if (signature !== undefined) signal.signature = signature;
  if (version !== undefined) signal.version = version;

  return Object.freeze(signal);
}

function normalizeLabelStateValue(input: RecommendationAtprotoLabelStateValue): RecommendationAtprotoLabelSignal {
  return isNormalizedLabelSignal(input)
    ? normalizeRecommendationAtprotoLabelSignal(input)
    : normalizeRecommendationAtprotoLabel(input as RecommendationAtprotoLabelInput);
}

export function normalizeRecommendationAtprotoLabel(input: RecommendationAtprotoLabelInput): RecommendationAtprotoLabelSignal {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid ATProto label input.");
  }

  const signal: RecommendationAtprotoLabelSignal = {
    labelerDid: normalizeDid(input.src, "source DID"),
    targetUri: normalizeUri(input.uri),
    value: normalizeLabelValue(input.val),
    createdAt: normalizeTimestamp(input.cts, "creation timestamp"),
    provenance: normalizeProvenance(input.provenance),
    negated: normalizeOptionalBoolean(input.neg, "negation flag") ?? false
  };

  const targetCid = normalizeOptionalCid(input.cid);
  const expiresAt = normalizeOptionalTimestamp(input.exp, "expiration timestamp");
  const signature = normalizeOptionalSignature(input.sig);
  const version = normalizeOptionalVersion(input.ver);

  if (targetCid !== undefined) signal.targetCid = targetCid;
  if (expiresAt !== undefined) signal.expiresAt = expiresAt;
  if (signature !== undefined) signal.signature = signature;
  if (version !== undefined) signal.version = version;

  return Object.freeze(signal);
}

export function isRecommendationAtprotoLabelExpired(
  label: RecommendationAtprotoLabelSignal,
  now: string = new Date().toISOString()
): boolean {
  const safeLabel = normalizeRecommendationAtprotoLabelSignal(label);
  if (safeLabel.expiresAt === undefined) return false;
  return compareTimestamps(safeLabel.expiresAt, normalizeTimestamp(now, "current timestamp")) <= 0;
}

export function mergeRecommendationAtprotoLabelState(
  input: RecommendationAtprotoLabelStateInput
): RecommendationAtprotoLabelSignal | undefined {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid ATProto label state input.");
  }

  const incoming = normalizeLabelStateValue(input.incoming);
  const existing = input.existing === undefined ? undefined : normalizeLabelStateValue(input.existing);

  if (
    existing !== undefined &&
    (existing.labelerDid !== incoming.labelerDid ||
      existing.targetUri !== incoming.targetUri ||
      existing.value !== incoming.value ||
      existing.targetCid !== incoming.targetCid)
  ) {
    throw new TypeError("ATProto label state entries do not refer to the same label target.");
  }

  const winner = existing === undefined || compareTimestamps(incoming.createdAt, existing.createdAt) >= 0 ? incoming : existing;
  const now = input.now === undefined ? undefined : normalizeTimestamp(input.now, "current timestamp");
  if (now !== undefined && isRecommendationAtprotoLabelExpired(winner, now)) {
    return undefined;
  }

  return winner;
}
