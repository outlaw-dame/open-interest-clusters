import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationSourceVisibility
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  ATPROTO_RECOMMENDATION_SOURCE_NORMALIZER_ID,
  ACTIVITYPUB_RECOMMENDATION_SOURCE_NORMALIZER_ID,
  createActivityPubRecommendationSourceItem,
  createAtprotoRecommendationSourceItem,
  type RecommendationProtocolNormalizationRejectionEvent,
  type RecommendationProtocolNormalizationRejectionReason,
  type RecommendationActivityPubNormalizedEvent,
  type RecommendationAtprotoNormalizedRecordEvent,
  type RecommendationProtocolSourceNormalizerOptions
} from "./protocol-source-normalizers.js";
import {
  RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES,
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceAdapterReadResult,
  normalizeRecommendationSourceItem,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult,
  type RecommendationSourceContext,
  type RecommendationSourceItem
} from "./source-adapter.js";

export const ACTIVITYPUB_RECOMMENDATION_SOURCE_ADAPTER_ID = "activitypub-provider-source-adapter" as const;
export const ATPROTO_RECOMMENDATION_SOURCE_ADAPTER_ID = "atproto-provider-source-adapter" as const;

export const RECOMMENDATION_PROTOCOL_SOURCE_READ_AUTHORIZATION_STATUSES = ["authorized"] as const;
export type RecommendationProtocolSourceReadAuthorizationStatus =
  typeof RECOMMENDATION_PROTOCOL_SOURCE_READ_AUTHORIZATION_STATUSES[number];

export interface RecommendationProtocolSourceReadAuthorization {
  status: RecommendationProtocolSourceReadAuthorizationStatus;
  subjectId: string;
  checkedAt: string;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationProtocolSourceAdapterRecordReadResult<TRecord> {
  records: readonly TRecord[];
  authorization: RecommendationProtocolSourceReadAuthorization;
  cursor?: string;
}

export type RecommendationProtocolSourceAdapterRecordReader<TRecord> = (
  request: RecommendationSourceAdapterReadRequest
) =>
  | RecommendationProtocolSourceAdapterRecordReadResult<TRecord>
  | Promise<RecommendationProtocolSourceAdapterRecordReadResult<TRecord>>;

export interface RecommendationProtocolSourceAdapterBaseInput<TRecord> {
  id?: string;
  sourceSystem?: string;
  capabilities?: readonly RecommendationSourceAdapterCapability[];
  normalizerOptions?: RecommendationProtocolSourceNormalizerOptions;
  maxRecordsPerRead?: number;
  read: RecommendationProtocolSourceAdapterRecordReader<TRecord>;
}

export type RecommendationActivityPubSourceAdapterInput =
  RecommendationProtocolSourceAdapterBaseInput<RecommendationActivityPubNormalizedEvent>;

export type RecommendationAtprotoSourceAdapterInput =
  RecommendationProtocolSourceAdapterBaseInput<RecommendationAtprotoNormalizedRecordEvent>;

const DEFAULT_ACTIVITYPUB_PROVIDER_SOURCE_SYSTEM = "activitypub.provider.normalized.v1";
const DEFAULT_ATPROTO_PROVIDER_SOURCE_SYSTEM = "atproto.provider.normalized.v1";
const DEFAULT_MAX_RECORDS_PER_READ = 500;
const MAX_RECORDS_PER_READ = 1_000;
const MAX_ADAPTER_IDENTIFIER_LENGTH = 256;
const MAX_SOURCE_SYSTEM_LENGTH = 256;
const MAX_CURSOR_LENGTH = 1_024;
const SOURCE_VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);
const CAPABILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES);
const DEFAULT_ACTIVITYPUB_CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_public",
  "read_private_with_authorization",
  "supports_incremental_sync",
  "supports_deletion_events"
]);
const DEFAULT_ATPROTO_CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_public",
  "read_relationships",
  "read_moderation_signals",
  "supports_incremental_sync",
  "supports_deletion_events"
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !hasUnsafeControlCharacter(value);
}

function requiredBoundedNonEmptyString(value: unknown, maxLength: number, label: string): string {
  if (!isBoundedNonEmptyString(value, maxLength)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function optionalBoundedNonEmptyString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredBoundedNonEmptyString(value, maxLength, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function normalizeCheckedAt(value: unknown): string {
  const checkedAt = requiredBoundedNonEmptyString(value, MAX_CURSOR_LENGTH, "protocol source read authorization timestamp");
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "protocol-source-authorization", since: checkedAt });
  return checkedAt;
}

function normalizeMaxRecordsPerRead(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_MAX_RECORDS_PER_READ;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_RECORDS_PER_READ) {
    throw new TypeError("Invalid protocol source max records per read.");
  }

  return value;
}

function normalizeCapabilities(
  value: unknown,
  defaults: readonly RecommendationSourceAdapterCapability[]
): readonly RecommendationSourceAdapterCapability[] {
  if (value === undefined) {
    return defaults;
  }

  if (!Array.isArray(value) || value.some((capability) => typeof capability !== "string" || !CAPABILITY_SET.has(capability))) {
    throw new TypeError("Invalid protocol source adapter capabilities.");
  }

  if (new Set(value).size !== value.length) {
    throw new TypeError("Invalid protocol source adapter capabilities.");
  }

  return Object.freeze([...value]) as readonly RecommendationSourceAdapterCapability[];
}

function normalizeSourceVisibility(value: unknown): RecommendationSourceVisibility {
  if (typeof value !== "string" || !SOURCE_VISIBILITY_SET.has(value)) {
    throw new TypeError("Invalid protocol source read authorization visibility.");
  }

  return value as RecommendationSourceVisibility;
}

function normalizeAccessBasis(value: unknown): RecommendationAccessBasis {
  if (typeof value !== "string" || !ACCESS_BASIS_SET.has(value)) {
    throw new TypeError("Invalid protocol source read authorization access basis.");
  }

  return value as RecommendationAccessBasis;
}

function normalizeAuthorization(
  value: unknown,
  request: RecommendationSourceAdapterReadRequest
): RecommendationProtocolSourceReadAuthorization {
  if (!isPlainRecord(value) || value.status !== "authorized") {
    throw new TypeError("Invalid protocol source read authorization.");
  }

  const subjectId = requiredBoundedNonEmptyString(value.subjectId, MAX_CURSOR_LENGTH, "protocol source read authorization subject");
  if (subjectId !== request.subjectId) {
    throw new TypeError("Protocol source read authorization subject mismatch.");
  }

  const authorization: RecommendationProtocolSourceReadAuthorization = {
    status: "authorized",
    subjectId,
    checkedAt: normalizeCheckedAt(value.checkedAt),
    sourceVisibility: normalizeSourceVisibility(value.sourceVisibility),
    accessBasis: normalizeAccessBasis(value.accessBasis)
  };
  const containsPrivateData = optionalBoolean(value.containsPrivateData, "protocol source read authorization private-data flag");
  const containsThirdPartyData = optionalBoolean(
    value.containsThirdPartyData,
    "protocol source read authorization third-party-data flag"
  );
  const serverSideProcessing = optionalBoolean(value.serverSideProcessing, "protocol source read authorization server-processing flag");
  const providerPolicyAllowsProcessing = optionalBoolean(
    value.providerPolicyAllowsProcessing,
    "protocol source read authorization provider-policy flag"
  );

  if (containsPrivateData !== undefined) authorization.containsPrivateData = containsPrivateData;
  if (containsThirdPartyData !== undefined) authorization.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) authorization.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) authorization.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return Object.freeze(authorization);
}

function privateVisibility(visibility: RecommendationSourceVisibility): boolean {
  return (
    visibility === "followers_only" ||
    visibility === "mentioned_only" ||
    visibility === "mutuals_only" ||
    visibility === "local_only" ||
    visibility === "acl_controlled"
  );
}

function authorizationRequiresPrivateRead(authorization: RecommendationProtocolSourceReadAuthorization): boolean {
  return authorization.containsPrivateData === true || privateVisibility(authorization.sourceVisibility);
}

function sourceItemRequiresPrivateRead(item: RecommendationSourceItem): boolean {
  return item.context.containsPrivateData === true || privateVisibility(item.context.sourceVisibility);
}

function requireCapabilitiesForAuthorization(
  capabilities: readonly RecommendationSourceAdapterCapability[],
  authorization: RecommendationProtocolSourceReadAuthorization
): void {
  if (authorizationRequiresPrivateRead(authorization) && !capabilities.includes("read_private_with_authorization")) {
    throw new TypeError("Protocol source adapter lacks private-read authorization capability.");
  }
}

function requireCapabilitiesForSourceItem(
  capabilities: readonly RecommendationSourceAdapterCapability[],
  item: RecommendationSourceItem
): void {
  if (sourceItemRequiresPrivateRead(item) && !capabilities.includes("read_private_with_authorization")) {
    throw new TypeError("Protocol source adapter lacks private-read authorization capability.");
  }
}

function requireAuthorizationCoversSourceItem(
  authorization: RecommendationProtocolSourceReadAuthorization,
  item: RecommendationSourceItem
): void {
  if (sourceItemRequiresPrivateRead(item) && !authorizationRequiresPrivateRead(authorization)) {
    throw new TypeError("Protocol source read authorization does not cover private source item.");
  }
}

function normalizeProviderReadResult<TRecord>(
  value: unknown,
  request: RecommendationSourceAdapterReadRequest,
  maxRecordsPerRead: number,
  capabilities: readonly RecommendationSourceAdapterCapability[]
): RecommendationProtocolSourceAdapterRecordReadResult<TRecord> {
  if (!isPlainRecord(value) || !Array.isArray(value.records) || value.records.length > maxRecordsPerRead) {
    throw new TypeError("Invalid protocol source adapter read result.");
  }

  const cursor = optionalBoundedNonEmptyString(value.cursor, MAX_CURSOR_LENGTH, "protocol source adapter cursor");
  const authorization = normalizeAuthorization(value.authorization, request);
  requireCapabilitiesForAuthorization(capabilities, authorization);

  const result: RecommendationProtocolSourceAdapterRecordReadResult<TRecord> = {
    records: Object.freeze([...value.records]) as readonly TRecord[],
    authorization
  };

  if (cursor !== undefined) {
    result.cursor = cursor;
  }

  return Object.freeze(result);
}

function providerPolicyFlag(
  sourceValue: boolean | undefined,
  authorizationValue: boolean | undefined
): boolean | undefined {
  if (sourceValue === false || authorizationValue === false) return false;
  if (sourceValue === true || authorizationValue === true) return true;
  return undefined;
}

function sourceContextWithAuthorization(
  context: RecommendationSourceContext,
  authorization: RecommendationProtocolSourceReadAuthorization
): RecommendationSourceContext {
  const next: RecommendationSourceContext = {
    ...context,
    sourceVisibility: authorization.sourceVisibility,
    accessBasis: authorization.accessBasis,
    containsPrivateData:
      context.containsPrivateData === true ||
      authorization.containsPrivateData === true ||
      privateVisibility(context.sourceVisibility) ||
      privateVisibility(authorization.sourceVisibility)
  };
  const containsThirdPartyData = context.containsThirdPartyData === true || authorization.containsThirdPartyData === true;
  const serverSideProcessing = context.serverSideProcessing === true || authorization.serverSideProcessing === true;
  const providerPolicyAllowsProcessing = providerPolicyFlag(
    context.providerPolicyAllowsProcessing,
    authorization.providerPolicyAllowsProcessing
  );

  if (containsThirdPartyData) next.containsThirdPartyData = true;
  if (serverSideProcessing) next.serverSideProcessing = true;
  if (providerPolicyAllowsProcessing !== undefined) next.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return Object.freeze(next);
}

function applyAuthorizationToSourceItem(
  item: RecommendationSourceItem,
  authorization: RecommendationProtocolSourceReadAuthorization,
  capabilities: readonly RecommendationSourceAdapterCapability[]
): RecommendationSourceItem {
  requireAuthorizationCoversSourceItem(authorization, item);
  requireCapabilitiesForSourceItem(capabilities, item);

  return normalizeRecommendationSourceItem({
    kind: item.kind,
    context: sourceContextWithAuthorization(item.context, authorization),
    provenance: item.provenance
  });
}

function mergeAuthorizationIntoNormalizerOptions(
  base: RecommendationProtocolSourceNormalizerOptions,
  adapterId: string,
  sourceSystem: string,
  authorization: RecommendationProtocolSourceReadAuthorization
): RecommendationProtocolSourceNormalizerOptions {
  const next: RecommendationProtocolSourceNormalizerOptions = {
    ...base,
    adapterId,
    sourceSystem
  };

  if (authorization.containsThirdPartyData === true) {
    next.containsThirdPartyData = true;
  }

  if (authorization.serverSideProcessing === true) {
    next.serverSideProcessing = true;
  }

  if (authorization.providerPolicyAllowsProcessing === false) {
    next.providerPolicyAllowsProcessing = false;
  } else if (authorization.providerPolicyAllowsProcessing === true && next.providerPolicyAllowsProcessing === undefined) {
    next.providerPolicyAllowsProcessing = true;
  }

  return Object.freeze(next);
}

function normalizeSourceAdapterResult(
  items: RecommendationSourceItem[],
  cursor: string | undefined
): RecommendationSourceAdapterReadResult {
  const result: RecommendationSourceAdapterReadResult = { items: Object.freeze(items) };
  if (cursor !== undefined) {
    result.cursor = cursor;
  }

  return normalizeRecommendationSourceAdapterReadResult(result);
}

function recordNormalizationRejection(
  options: RecommendationProtocolSourceNormalizerOptions,
  protocol: RecommendationProtocolNormalizationRejectionEvent["protocol"],
  reason: RecommendationProtocolNormalizationRejectionReason
): void {
  const callback = options.onNormalizationRejected;
  if (callback === undefined) {
    return;
  }

  try {
    callback(Object.freeze({ protocol, reason }));
  } catch {
    // Rejection counters must never interfere with fail-closed normalization behavior.
  }
}

function normalizeAdapterFactoryInput<TRecord>(
  input: RecommendationProtocolSourceAdapterBaseInput<TRecord>,
  defaults: {
    adapterId: string;
    sourceSystem: string;
    capabilities: readonly RecommendationSourceAdapterCapability[];
  }
): {
  id: string;
  sourceSystem: string;
  capabilities: readonly RecommendationSourceAdapterCapability[];
  normalizerOptions: RecommendationProtocolSourceNormalizerOptions;
  maxRecordsPerRead: number;
  read: RecommendationProtocolSourceAdapterRecordReader<TRecord>;
} {
  if (!isPlainRecord(input) || typeof input.read !== "function") {
    throw new TypeError("Invalid protocol source adapter input.");
  }

  const id = optionalBoundedNonEmptyString(input.id, MAX_ADAPTER_IDENTIFIER_LENGTH, "protocol source adapter id") ?? defaults.adapterId;
  const sourceSystem =
    optionalBoundedNonEmptyString(input.sourceSystem, MAX_SOURCE_SYSTEM_LENGTH, "protocol source system") ?? defaults.sourceSystem;
  const capabilities = normalizeCapabilities(input.capabilities, defaults.capabilities);
  const maxRecordsPerRead = normalizeMaxRecordsPerRead(input.maxRecordsPerRead);
  const normalizerOptions = isPlainRecord(input.normalizerOptions) || input.normalizerOptions === undefined
    ? Object.freeze({ ...(input.normalizerOptions ?? {}) })
    : undefined;

  if (normalizerOptions === undefined) {
    throw new TypeError("Invalid protocol source normalizer options.");
  }

  return Object.freeze({
    id,
    sourceSystem,
    capabilities,
    normalizerOptions,
    maxRecordsPerRead,
    read: input.read
  });
}

export function createActivityPubRecommendationSourceAdapter(
  input: RecommendationActivityPubSourceAdapterInput
): RecommendationSourceAdapter {
  const safeInput = normalizeAdapterFactoryInput(input, {
    adapterId: ACTIVITYPUB_RECOMMENDATION_SOURCE_ADAPTER_ID,
    sourceSystem: DEFAULT_ACTIVITYPUB_PROVIDER_SOURCE_SYSTEM,
    capabilities: DEFAULT_ACTIVITYPUB_CAPABILITIES
  });

  return Object.freeze({
    id: safeInput.id,
    protocol: "activitypub",
    capabilities: safeInput.capabilities,
    read: async (request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult> => {
      const safeRequest = normalizeRecommendationSourceAdapterReadRequest(request);
      const providerResult = normalizeProviderReadResult<RecommendationActivityPubNormalizedEvent>(
        await safeInput.read(safeRequest),
        safeRequest,
        safeInput.maxRecordsPerRead,
        safeInput.capabilities
      );
      const normalizerOptions = mergeAuthorizationIntoNormalizerOptions(
        safeInput.normalizerOptions,
        safeInput.id,
        safeInput.sourceSystem,
        providerResult.authorization
      );
      const items: RecommendationSourceItem[] = [];

      for (const record of providerResult.records) {
        let item: RecommendationSourceItem | null;
        try {
          item = createActivityPubRecommendationSourceItem(record, normalizerOptions);
        } catch (error) {
          if (error instanceof TypeError) {
            recordNormalizationRejection(normalizerOptions, "activitypub", "invalid_activitypub_record");
          }
          throw error;
        }

        if (item !== null) {
          items.push(applyAuthorizationToSourceItem(item, providerResult.authorization, safeInput.capabilities));
        }
      }

      return normalizeSourceAdapterResult(items, providerResult.cursor);
    }
  });
}

export function createAtprotoRecommendationSourceAdapter(
  input: RecommendationAtprotoSourceAdapterInput
): RecommendationSourceAdapter {
  const safeInput = normalizeAdapterFactoryInput(input, {
    adapterId: ATPROTO_RECOMMENDATION_SOURCE_ADAPTER_ID,
    sourceSystem: DEFAULT_ATPROTO_PROVIDER_SOURCE_SYSTEM,
    capabilities: DEFAULT_ATPROTO_CAPABILITIES
  });

  return Object.freeze({
    id: safeInput.id,
    protocol: "atproto",
    capabilities: safeInput.capabilities,
    read: async (request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult> => {
      const safeRequest = normalizeRecommendationSourceAdapterReadRequest(request);
      const providerResult = normalizeProviderReadResult<RecommendationAtprotoNormalizedRecordEvent>(
        await safeInput.read(safeRequest),
        safeRequest,
        safeInput.maxRecordsPerRead,
        safeInput.capabilities
      );
      const normalizerOptions = mergeAuthorizationIntoNormalizerOptions(
        safeInput.normalizerOptions,
        safeInput.id,
        safeInput.sourceSystem,
        providerResult.authorization
      );
      const items: RecommendationSourceItem[] = [];

      for (const record of providerResult.records) {
        let item: RecommendationSourceItem | null;
        try {
          item = createAtprotoRecommendationSourceItem(record, normalizerOptions);
        } catch (error) {
          if (error instanceof TypeError) {
            recordNormalizationRejection(normalizerOptions, "atproto", "invalid_atproto_record");
          }
          throw error;
        }

        if (item !== null) {
          items.push(applyAuthorizationToSourceItem(item, providerResult.authorization, safeInput.capabilities));
        }
      }

      return normalizeSourceAdapterResult(items, providerResult.cursor);
    }
  });
}

export const RECOMMENDATION_PROTOCOL_SOURCE_NORMALIZER_IDS = Object.freeze({
  activitypub: ACTIVITYPUB_RECOMMENDATION_SOURCE_NORMALIZER_ID,
  atproto: ATPROTO_RECOMMENDATION_SOURCE_NORMALIZER_ID
});
