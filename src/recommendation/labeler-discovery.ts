import { sha256Hex } from "../runtime/hash.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export const RECOMMENDATION_LABELER_DISCOVERY_SOURCES = [
  "user_provided",
  "host_app_directory",
  "atproto_profile",
  "imported"
] as const;
export type RecommendationLabelerDiscoverySource = typeof RECOMMENDATION_LABELER_DISCOVERY_SOURCES[number];

export const RECOMMENDATION_LABELER_DISCOVERY_VERIFICATIONS = [
  "did_document",
  "did_document_and_declaration"
] as const;
export type RecommendationLabelerDiscoveryVerification = typeof RECOMMENDATION_LABELER_DISCOVERY_VERIFICATIONS[number];

export interface RecommendationLabelerDidServiceInput {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface RecommendationLabelerDidDocumentInput {
  id: string;
  service: readonly RecommendationLabelerDidServiceInput[];
}

export interface RecommendationLabelerDeclarationInput {
  type: "app.bsky.labeler.service";
  recordKey: "self";
  createdAt: string;
  labelValues: readonly string[];
  subjectTypes?: readonly string[];
  subjectCollections?: readonly string[];
}

export interface RecommendationLabelerDiscoveryObservationInput {
  source: RecommendationLabelerDiscoverySource;
  discoveredAt: string;
  didDocument: RecommendationLabelerDidDocumentInput;
  declaration?: RecommendationLabelerDeclarationInput;
}

export interface RecommendationDiscoveredLabeler {
  discoveryKey: string;
  labelerDid: string;
  serviceEndpoint: string;
  source: RecommendationLabelerDiscoverySource;
  discoveredAt: string;
  verification: RecommendationLabelerDiscoveryVerification;
  declaredLabelValues: readonly string[];
  declaredSubjectTypes: readonly string[];
  declaredSubjectCollections: readonly string[];
  requiresExplicitSubscription: true;
}

export interface RecommendationLabelerDiscoveryRegistry {
  upsert(input: RecommendationLabelerDiscoveryObservationInput): RecommendationDiscoveredLabeler;
  get(labelerDid: string): RecommendationDiscoveredLabeler | undefined;
  list(): readonly RecommendationDiscoveredLabeler[];
  remove(labelerDid: string): boolean;
  clear(): void;
}

const SOURCE_SET = new Set<string>(RECOMMENDATION_LABELER_DISCOVERY_SOURCES);
const MAX_DID_LENGTH = 256;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_POLICY_VALUE_LENGTH = 256;
const MAX_POLICY_VALUES = 1_000;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const POLICY_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:#/-]*$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function normalizeDid(value: unknown, message = "Invalid recommendation labeler discovery DID."): string {
  const normalized = boundedString(value, MAX_DID_LENGTH, message);
  if (!DID_PATTERN.test(normalized) || /\s/u.test(normalized)) throw new TypeError(message);
  return normalized;
}

function normalizeTimestamp(value: unknown): string {
  const normalized = boundedString(
    value,
    MAX_TIMESTAMP_LENGTH,
    "Invalid recommendation labeler discovery timestamp."
  );
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError("Invalid recommendation labeler discovery timestamp.");
  }
  return normalized;
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return true;
  if (host.includes(":")) return true;
  return host === "0.0.0.0" || host === "[::]" || host === "[::1]";
}

function normalizeServiceEndpoint(value: unknown): string {
  const raw = boundedString(
    value,
    MAX_ENDPOINT_LENGTH,
    "Invalid recommendation labeler discovery service endpoint."
  );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Invalid recommendation labeler discovery service endpoint.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.hostname.length === 0 ||
    isUnsafeHost(parsed.hostname)
  ) {
    throw new TypeError("Invalid recommendation labeler discovery service endpoint.");
  }
  parsed.pathname = "/";
  return parsed.toString();
}

function normalizePolicyValues(value: unknown, message: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_POLICY_VALUES) throw new TypeError(message);
  const unique = new Set<string>();
  for (const entry of value) {
    const normalized = boundedString(entry, MAX_POLICY_VALUE_LENGTH, message);
    if (!POLICY_VALUE_PATTERN.test(normalized)) throw new TypeError(message);
    unique.add(normalized);
  }
  return Object.freeze([...unique].sort());
}

function normalizeSource(value: unknown): RecommendationLabelerDiscoverySource {
  if (typeof value !== "string" || !SOURCE_SET.has(value)) {
    throw new TypeError("Invalid recommendation labeler discovery source.");
  }
  return value as RecommendationLabelerDiscoverySource;
}

function clone(candidate: RecommendationDiscoveredLabeler): RecommendationDiscoveredLabeler {
  return Object.freeze({
    ...candidate,
    declaredLabelValues: Object.freeze([...candidate.declaredLabelValues]),
    declaredSubjectTypes: Object.freeze([...candidate.declaredSubjectTypes]),
    declaredSubjectCollections: Object.freeze([...candidate.declaredSubjectCollections])
  });
}

export function normalizeRecommendationLabelerDiscoveryObservation(
  input: RecommendationLabelerDiscoveryObservationInput
): RecommendationDiscoveredLabeler {
  if (!isPlainRecord(input) || !isPlainRecord(input.didDocument) || !Array.isArray(input.didDocument.service)) {
    throw new TypeError("Invalid recommendation labeler discovery observation.");
  }

  const source = normalizeSource(input.source);
  const discoveredAt = normalizeTimestamp(input.discoveredAt);
  const labelerDid = normalizeDid(input.didDocument.id);
  const expectedServiceId = `${labelerDid}#atproto_labeler`;
  const matchingServices = input.didDocument.service.filter((service) =>
    isPlainRecord(service) && service.id === expectedServiceId && service.type === "AtprotoLabeler"
  );
  if (matchingServices.length !== 1) {
    throw new TypeError("Recommendation labeler discovery requires exactly one matching ATProto labeler service.");
  }
  const serviceEndpoint = normalizeServiceEndpoint(matchingServices[0]?.serviceEndpoint);

  let verification: RecommendationLabelerDiscoveryVerification = "did_document";
  let declaredLabelValues: readonly string[] = Object.freeze([]);
  let declaredSubjectTypes: readonly string[] = Object.freeze([]);
  let declaredSubjectCollections: readonly string[] = Object.freeze([]);

  if (input.declaration !== undefined) {
    if (!isPlainRecord(input.declaration)) {
      throw new TypeError("Invalid recommendation labeler discovery declaration.");
    }
    if (input.declaration.type !== "app.bsky.labeler.service" || input.declaration.recordKey !== "self") {
      throw new TypeError("Invalid recommendation labeler discovery declaration identity.");
    }
    normalizeTimestamp(input.declaration.createdAt);
    declaredLabelValues = normalizePolicyValues(
      input.declaration.labelValues,
      "Invalid recommendation labeler discovery label policy."
    );
    declaredSubjectTypes = normalizePolicyValues(
      input.declaration.subjectTypes,
      "Invalid recommendation labeler discovery subject types."
    );
    declaredSubjectCollections = normalizePolicyValues(
      input.declaration.subjectCollections,
      "Invalid recommendation labeler discovery subject collections."
    );
    verification = "did_document_and_declaration";
  }

  return Object.freeze({
    discoveryKey: `labeler-discovery:${sha256Hex(`${labelerDid}\u0000${serviceEndpoint}`)}`,
    labelerDid,
    serviceEndpoint,
    source,
    discoveredAt,
    verification,
    declaredLabelValues,
    declaredSubjectTypes,
    declaredSubjectCollections,
    requiresExplicitSubscription: true as const
  });
}

export function createInMemoryRecommendationLabelerDiscoveryRegistry(): RecommendationLabelerDiscoveryRegistry {
  const candidates = new Map<string, RecommendationDiscoveredLabeler>();

  return Object.freeze({
    upsert(input: RecommendationLabelerDiscoveryObservationInput): RecommendationDiscoveredLabeler {
      const incoming = normalizeRecommendationLabelerDiscoveryObservation(input);
      const existing = candidates.get(incoming.labelerDid);
      if (existing !== undefined) {
        const existingTime = Date.parse(existing.discoveredAt);
        const incomingTime = Date.parse(incoming.discoveredAt);
        const replace = incomingTime > existingTime || (
          incomingTime === existingTime && incoming.discoveryKey.localeCompare(existing.discoveryKey) > 0
        );
        if (!replace) return clone(existing);
      }
      candidates.set(incoming.labelerDid, incoming);
      return clone(incoming);
    },

    get(rawDid: string): RecommendationDiscoveredLabeler | undefined {
      const existing = candidates.get(normalizeDid(rawDid));
      return existing === undefined ? undefined : clone(existing);
    },

    list(): readonly RecommendationDiscoveredLabeler[] {
      return Object.freeze(
        [...candidates.values()]
          .sort((left, right) => left.labelerDid.localeCompare(right.labelerDid))
          .map(clone)
      );
    },

    remove(rawDid: string): boolean {
      return candidates.delete(normalizeDid(rawDid));
    },

    clear(): void {
      candidates.clear();
    }
  });
}
