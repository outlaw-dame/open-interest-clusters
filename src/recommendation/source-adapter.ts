import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_PROTOCOLS,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationConsentRequest,
  type RecommendationDataUse,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";

export const RECOMMENDATION_SOURCE_ITEM_KINDS = [
  "post",
  "profile",
  "tag",
  "collection",
  "reaction",
  "follow",
  "block",
  "mute",
  "label"
] as const;

export type RecommendationSourceItemKind = typeof RECOMMENDATION_SOURCE_ITEM_KINDS[number];

export const RECOMMENDATION_SOURCE_TRUST_BOUNDARIES = [
  "user_owned",
  "same_provider",
  "remote_provider",
  "third_party",
  "unknown"
] as const;

export type RecommendationSourceTrustBoundary = typeof RECOMMENDATION_SOURCE_TRUST_BOUNDARIES[number];

export const RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES = [
  "read_public",
  "read_private_with_authorization",
  "read_relationships",
  "read_moderation_signals",
  "supports_incremental_sync",
  "supports_deletion_events"
] as const;

export type RecommendationSourceAdapterCapability = typeof RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES[number];

export interface RecommendationSourceContext {
  protocol: RecommendationProtocol;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationSourceProvenance {
  adapterId: string;
  sourceSystem: string;
  observedAt: string;
  trustBoundary: RecommendationSourceTrustBoundary;
  opaqueSourceId?: string;
}

export interface RecommendationSourceItem {
  kind: RecommendationSourceItemKind;
  context: RecommendationSourceContext;
  provenance: RecommendationSourceProvenance;
}

export interface RecommendationSourceAdapterReadRequest {
  subjectId: string;
  since?: string;
  cursor?: string;
  limit?: number;
}

export interface RecommendationSourceAdapterReadResult {
  items: readonly RecommendationSourceItem[];
  cursor?: string;
}

export interface RecommendationSourceAdapter {
  id: string;
  protocol: RecommendationProtocol;
  capabilities: readonly RecommendationSourceAdapterCapability[];
  read(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult> | RecommendationSourceAdapterReadResult;
}

export interface RecommendationConsentRequestFromSourceInput {
  subjectId: string;
  dataUse: RecommendationDataUse;
  source: RecommendationSourceItem;
}

const SOURCE_ITEM_KIND_SET = new Set<string>(RECOMMENDATION_SOURCE_ITEM_KINDS);
const TRUST_BOUNDARY_SET = new Set<string>(RECOMMENDATION_SOURCE_TRUST_BOUNDARIES);
const ADAPTER_CAPABILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && value > 0);
}

function isKnownSourceItemKind(value: unknown): value is RecommendationSourceItemKind {
  return typeof value === "string" && SOURCE_ITEM_KIND_SET.has(value);
}

function isKnownTrustBoundary(value: unknown): value is RecommendationSourceTrustBoundary {
  return typeof value === "string" && TRUST_BOUNDARY_SET.has(value);
}

function isKnownAdapterCapability(value: unknown): value is RecommendationSourceAdapterCapability {
  return typeof value === "string" && ADAPTER_CAPABILITY_SET.has(value);
}

function isKnownProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
}

function isKnownVisibility(value: unknown): value is RecommendationSourceVisibility {
  return typeof value === "string" && VISIBILITY_SET.has(value);
}

function isKnownAccessBasis(value: unknown): value is RecommendationAccessBasis {
  return typeof value === "string" && ACCESS_BASIS_SET.has(value);
}

function isValidSourceContext(value: unknown): value is RecommendationSourceContext {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecommendationSourceContext>;

  return (
    isKnownProtocol(candidate.protocol) &&
    isKnownVisibility(candidate.sourceVisibility) &&
    isKnownAccessBasis(candidate.accessBasis) &&
    isOptionalBoolean(candidate.containsPrivateData) &&
    isOptionalBoolean(candidate.containsThirdPartyData) &&
    isOptionalBoolean(candidate.serverSideProcessing) &&
    isOptionalBoolean(candidate.providerPolicyAllowsProcessing)
  );
}

function isValidSourceProvenance(value: unknown): value is RecommendationSourceProvenance {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecommendationSourceProvenance>;

  return (
    isNonEmptyString(candidate.adapterId) &&
    isNonEmptyString(candidate.sourceSystem) &&
    isNonEmptyString(candidate.observedAt) &&
    isKnownTrustBoundary(candidate.trustBoundary) &&
    isOptionalNonEmptyString(candidate.opaqueSourceId)
  );
}

export function isRecommendationSourceItem(value: unknown): value is RecommendationSourceItem {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecommendationSourceItem>;

  return (
    isKnownSourceItemKind(candidate.kind) &&
    isValidSourceContext(candidate.context) &&
    isValidSourceProvenance(candidate.provenance)
  );
}

function cloneSourceContext(context: RecommendationSourceContext): RecommendationSourceContext {
  const next: RecommendationSourceContext = {
    protocol: context.protocol,
    sourceVisibility: context.sourceVisibility,
    accessBasis: context.accessBasis
  };

  if (context.containsPrivateData !== undefined) {
    next.containsPrivateData = context.containsPrivateData;
  }

  if (context.containsThirdPartyData !== undefined) {
    next.containsThirdPartyData = context.containsThirdPartyData;
  }

  if (context.serverSideProcessing !== undefined) {
    next.serverSideProcessing = context.serverSideProcessing;
  }

  if (context.providerPolicyAllowsProcessing !== undefined) {
    next.providerPolicyAllowsProcessing = context.providerPolicyAllowsProcessing;
  }

  return Object.freeze(next);
}

function cloneSourceProvenance(provenance: RecommendationSourceProvenance): RecommendationSourceProvenance {
  const next: RecommendationSourceProvenance = {
    adapterId: provenance.adapterId,
    sourceSystem: provenance.sourceSystem,
    observedAt: provenance.observedAt,
    trustBoundary: provenance.trustBoundary
  };

  if (provenance.opaqueSourceId !== undefined) {
    next.opaqueSourceId = provenance.opaqueSourceId;
  }

  return Object.freeze(next);
}

export function normalizeRecommendationSourceItem(value: unknown): RecommendationSourceItem {
  if (!isRecommendationSourceItem(value)) {
    throw new TypeError("Invalid recommendation source item.");
  }

  return Object.freeze({
    kind: value.kind,
    context: cloneSourceContext(value.context),
    provenance: cloneSourceProvenance(value.provenance)
  });
}

function isValidAdapterReadRequest(value: unknown): value is RecommendationSourceAdapterReadRequest {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecommendationSourceAdapterReadRequest>;

  return (
    isNonEmptyString(candidate.subjectId) &&
    isOptionalNonEmptyString(candidate.since) &&
    isOptionalNonEmptyString(candidate.cursor) &&
    isOptionalPositiveInteger(candidate.limit)
  );
}

export function normalizeRecommendationSourceAdapterReadRequest(
  value: unknown
): RecommendationSourceAdapterReadRequest {
  if (!isValidAdapterReadRequest(value)) {
    throw new TypeError("Invalid recommendation source adapter read request.");
  }

  const request = value as RecommendationSourceAdapterReadRequest;
  const next: RecommendationSourceAdapterReadRequest = {
    subjectId: request.subjectId
  };

  if (request.since !== undefined) {
    next.since = request.since;
  }

  if (request.cursor !== undefined) {
    next.cursor = request.cursor;
  }

  if (request.limit !== undefined) {
    next.limit = request.limit;
  }

  return Object.freeze(next);
}

export function normalizeRecommendationSourceAdapterReadResult(
  value: unknown
): RecommendationSourceAdapterReadResult {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Invalid recommendation source adapter read result.");
  }

  const candidate = value as Partial<RecommendationSourceAdapterReadResult>;
  if (!Array.isArray(candidate.items) || !isOptionalNonEmptyString(candidate.cursor)) {
    throw new TypeError("Invalid recommendation source adapter read result.");
  }

  const next: RecommendationSourceAdapterReadResult = {
    items: Object.freeze(candidate.items.map((item) => normalizeRecommendationSourceItem(item)))
  };

  if (candidate.cursor !== undefined) {
    next.cursor = candidate.cursor;
  }

  return Object.freeze(next);
}

export function isRecommendationSourceAdapter(value: unknown): value is RecommendationSourceAdapter {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RecommendationSourceAdapter>;

  return (
    isNonEmptyString(candidate.id) &&
    isKnownProtocol(candidate.protocol) &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every(isKnownAdapterCapability) &&
    typeof candidate.read === "function"
  );
}

export async function readRecommendationSourceAdapter(
  adapter: RecommendationSourceAdapter,
  request: RecommendationSourceAdapterReadRequest
): Promise<RecommendationSourceAdapterReadResult> {
  if (!isRecommendationSourceAdapter(adapter)) {
    throw new TypeError("Invalid recommendation source adapter.");
  }

  const safeRequest = normalizeRecommendationSourceAdapterReadRequest(request);
  const result = await adapter.read(safeRequest);
  return normalizeRecommendationSourceAdapterReadResult(result);
}

export function createRecommendationConsentRequestFromSource(
  input: RecommendationConsentRequestFromSourceInput
): RecommendationConsentRequest {
  if (input === null || typeof input !== "object" || !isNonEmptyString(input.subjectId)) {
    throw new TypeError("Invalid recommendation consent source input.");
  }

  const source = normalizeRecommendationSourceItem(input.source);
  const request: RecommendationConsentRequest = {
    subjectId: input.subjectId,
    dataUse: input.dataUse,
    protocol: source.context.protocol,
    sourceVisibility: source.context.sourceVisibility,
    accessBasis: source.context.accessBasis
  };

  if (source.context.containsPrivateData !== undefined) {
    request.containsPrivateData = source.context.containsPrivateData;
  }

  if (source.context.containsThirdPartyData !== undefined) {
    request.containsThirdPartyData = source.context.containsThirdPartyData;
  }

  if (source.context.serverSideProcessing !== undefined) {
    request.serverSideProcessing = source.context.serverSideProcessing;
  }

  if (source.context.providerPolicyAllowsProcessing !== undefined) {
    request.providerPolicyAllowsProcessing = source.context.providerPolicyAllowsProcessing;
  }

  return Object.freeze(request);
}
