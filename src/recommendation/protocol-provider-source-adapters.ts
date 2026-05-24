import { CANONICAL_RECOMMENDATION_PROJECTION_MODES } from "./canonical-source-adapter.js";
import {
  createActivityPubRecommendationSourceAdapter,
  createAtprotoRecommendationSourceAdapter,
  type RecommendationProtocolSourceAdapterBaseInput,
  type RecommendationProtocolSourceAdapterRecordReadResult
} from "./protocol-source-adapters.js";
import {
  mapActivityPubProviderActivityToNormalizedEvent,
  mapAtprotoProviderRecordToNormalizedEvent,
  mapMastodonProviderStatusToActivityPubNormalizedEvent,
  type RecommendationActivityPubProviderActivityMapInput,
  type RecommendationAtprotoProviderRecordMapInput,
  type RecommendationMastodonProviderStatusMapInput,
  type RecommendationProtocolProviderRecordFlags
} from "./protocol-source-provider-records.js";
import {
  RECOMMENDATION_SOURCE_TRUST_BOUNDARIES,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest
} from "./source-adapter.js";
import type {
  RecommendationActivityPubNormalizedEvent,
  RecommendationAtprotoNormalizedRecordEvent,
  RecommendationProtocolSourceNormalizerOptions
} from "./protocol-source-normalizers.js";

export const ACTIVITYPUB_PROVIDER_RECORD_RECOMMENDATION_SOURCE_ADAPTER_ID =
  "activitypub-provider-record-source-adapter" as const;
export const MASTODON_PROVIDER_STATUS_RECOMMENDATION_SOURCE_ADAPTER_ID =
  "mastodon-provider-status-source-adapter" as const;
export const ATPROTO_PROVIDER_RECORD_RECOMMENDATION_SOURCE_ADAPTER_ID =
  "atproto-provider-record-source-adapter" as const;

export const DEFAULT_ACTIVITYPUB_PROVIDER_RECORD_SOURCE_SYSTEM = "activitypub.provider.records.v1" as const;
export const DEFAULT_MASTODON_PROVIDER_STATUS_SOURCE_SYSTEM = "mastodon.provider.statuses.v1" as const;
export const DEFAULT_ATPROTO_PROVIDER_RECORD_SOURCE_SYSTEM = "atproto.provider.records.v1" as const;

export type RecommendationActivityPubProviderActivitySourceRecord = RecommendationActivityPubProviderActivityMapInput;
export type RecommendationMastodonProviderStatusSourceRecord = RecommendationMastodonProviderStatusMapInput;
export type RecommendationAtprotoProviderRecordSourceRecord = RecommendationAtprotoProviderRecordMapInput;

export type RecommendationProtocolProviderRecordSourceReadResult<TRecord> =
  RecommendationProtocolSourceAdapterRecordReadResult<TRecord>;

export type RecommendationProtocolProviderRecordSourceReader<TRecord> = (
  request: RecommendationSourceAdapterReadRequest
) =>
  | RecommendationProtocolProviderRecordSourceReadResult<TRecord>
  | Promise<RecommendationProtocolProviderRecordSourceReadResult<TRecord>>;

export interface RecommendationProtocolProviderRecordSourceAdapterInput<
  TRecord extends RecommendationProtocolProviderRecordFlags
> {
  id?: string;
  sourceSystem?: string;
  capabilities?: readonly RecommendationSourceAdapterCapability[];
  normalizerOptions?: RecommendationProtocolSourceNormalizerOptions;
  maxRecordsPerRead?: number;
  recordDefaults?: RecommendationProtocolProviderRecordFlags;
  read: RecommendationProtocolProviderRecordSourceReader<TRecord>;
}

export type RecommendationActivityPubProviderActivitySourceAdapterInput =
  RecommendationProtocolProviderRecordSourceAdapterInput<RecommendationActivityPubProviderActivitySourceRecord>;

export type RecommendationMastodonProviderStatusSourceAdapterInput =
  RecommendationProtocolProviderRecordSourceAdapterInput<RecommendationMastodonProviderStatusSourceRecord>;

export type RecommendationAtprotoProviderRecordSourceAdapterInput =
  RecommendationProtocolProviderRecordSourceAdapterInput<RecommendationAtprotoProviderRecordSourceRecord>;

const DEFAULT_MAX_RECORDS_PER_READ = 500;
const MAX_RECORDS_PER_READ = 1_000;
const MAX_CURSOR_LENGTH = 1_024;
const CONTROL_CODE_BLOCK_SIZE = 32;
const C1_CONTROL_CODE_BLOCK = 4;
const TRUST_BOUNDARY_SET = new Set<string>(RECOMMENDATION_SOURCE_TRUST_BOUNDARIES);
const PROJECTION_MODE_SET = new Set<string>(CANONICAL_RECOMMENDATION_PROJECTION_MODES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || Math.floor(code / CONTROL_CODE_BLOCK_SIZE) === C1_CONTROL_CODE_BLOCK) {
      return true;
    }
  }

  return false;
}

function optionalBoundedNonEmptyString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || hasControlCharacter(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid ${label}.`);
  return value;
}

function optionalKnownString<T extends string>(value: unknown, allowed: ReadonlySet<string>, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) throw new TypeError(`Invalid ${label}.`);
  return value as T;
}

function normalizeMaxRecordsPerRead(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_RECORDS_PER_READ;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_RECORDS_PER_READ) {
    throw new TypeError("Invalid protocol provider record source max records per read.");
  }

  return value;
}

function normalizeRecordDefaults(value: unknown): RecommendationProtocolProviderRecordFlags {
  if (value === undefined) return Object.freeze({});
  if (!isPlainRecord(value)) throw new TypeError("Invalid protocol provider record defaults.");

  const defaults: RecommendationProtocolProviderRecordFlags = {};
  const projectionMode = optionalKnownString(
    value.projectionMode,
    PROJECTION_MODE_SET,
    "protocol provider record default projection mode"
  );
  const trustBoundary = optionalKnownString(
    value.trustBoundary,
    TRUST_BOUNDARY_SET,
    "protocol provider record default trust boundary"
  );
  const containsThirdPartyData = optionalBoolean(
    value.containsThirdPartyData,
    "protocol provider record default third-party-data flag"
  );
  const serverSideProcessing = optionalBoolean(
    value.serverSideProcessing,
    "protocol provider record default server-processing flag"
  );
  const providerPolicyAllowsProcessing = optionalBoolean(
    value.providerPolicyAllowsProcessing,
    "protocol provider record default provider-policy flag"
  );

  if (projectionMode !== undefined) defaults.projectionMode = projectionMode;
  if (trustBoundary !== undefined) defaults.trustBoundary = trustBoundary;
  if (containsThirdPartyData !== undefined) defaults.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) defaults.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) {
    defaults.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  }

  return Object.freeze(defaults);
}

function normalizeProviderRecordAdapterInput<TRecord extends RecommendationProtocolProviderRecordFlags>(
  input: RecommendationProtocolProviderRecordSourceAdapterInput<TRecord>,
  defaults: { adapterId: string; sourceSystem: string }
): RecommendationProtocolProviderRecordSourceAdapterInput<TRecord> & {
  id: string;
  sourceSystem: string;
  maxRecordsPerRead: number;
  recordDefaults: RecommendationProtocolProviderRecordFlags;
} {
  if (!isPlainRecord(input) || typeof input.read !== "function") {
    throw new TypeError("Invalid protocol provider record source adapter input.");
  }

  return Object.freeze({
    ...input,
    id: input.id ?? defaults.adapterId,
    sourceSystem: input.sourceSystem ?? defaults.sourceSystem,
    maxRecordsPerRead: normalizeMaxRecordsPerRead(input.maxRecordsPerRead),
    recordDefaults: normalizeRecordDefaults(input.recordDefaults)
  });
}

function normalizeProviderRecordReadResultShape<TRecord>(
  value: unknown,
  request: RecommendationSourceAdapterReadRequest,
  maxRecordsPerRead: number
): RecommendationProtocolProviderRecordSourceReadResult<TRecord> {
  if (!isPlainRecord(value) || !Array.isArray(value.records) || value.records.length > maxRecordsPerRead) {
    throw new TypeError("Invalid protocol provider record source read result.");
  }

  if (!isPlainRecord(value.authorization) || value.authorization.status !== "authorized") {
    throw new TypeError("Invalid protocol provider record source authorization.");
  }

  if (value.authorization.subjectId !== request.subjectId) {
    throw new TypeError("Protocol provider record source authorization subject mismatch.");
  }

  const cursor = optionalBoundedNonEmptyString(value.cursor, MAX_CURSOR_LENGTH, "protocol provider record source cursor");
  const result: RecommendationProtocolProviderRecordSourceReadResult<TRecord> = {
    records: Object.freeze([...value.records]) as readonly TRecord[],
    authorization: value.authorization as RecommendationProtocolProviderRecordSourceReadResult<TRecord>["authorization"]
  };

  if (cursor !== undefined) result.cursor = cursor;
  return Object.freeze(result);
}

function withRecordDefaults<TRecord extends RecommendationProtocolProviderRecordFlags>(
  recordDefaults: RecommendationProtocolProviderRecordFlags,
  record: TRecord
): TRecord {
  return Object.freeze({ ...recordDefaults, ...record }) as TRecord;
}

function normalizedReadResult<TRecord>(
  records: readonly TRecord[],
  source: RecommendationProtocolProviderRecordSourceReadResult<unknown>
): RecommendationProtocolSourceAdapterRecordReadResult<TRecord> {
  const result: RecommendationProtocolSourceAdapterRecordReadResult<TRecord> = {
    records: Object.freeze([...records]),
    authorization: source.authorization
  };

  if (source.cursor !== undefined) result.cursor = source.cursor;
  return Object.freeze(result);
}

type ProtocolSourceAdapterFactory<TNormalizedRecord> = (
  input: RecommendationProtocolSourceAdapterBaseInput<TNormalizedRecord>
) => RecommendationSourceAdapter;

function createMappedProviderRecordSourceAdapter<
  TRecord extends RecommendationProtocolProviderRecordFlags,
  TNormalizedRecord
>(
  input: RecommendationProtocolProviderRecordSourceAdapterInput<TRecord>,
  defaults: { adapterId: string; sourceSystem: string },
  createProtocolAdapter: ProtocolSourceAdapterFactory<TNormalizedRecord>,
  mapRecord: (record: TRecord) => TNormalizedRecord
): RecommendationSourceAdapter {
  const safeInput = normalizeProviderRecordAdapterInput(input, defaults);

  return createProtocolAdapter({
    id: safeInput.id,
    sourceSystem: safeInput.sourceSystem,
    capabilities: safeInput.capabilities,
    normalizerOptions: safeInput.normalizerOptions,
    maxRecordsPerRead: safeInput.maxRecordsPerRead,
    read: async (request): Promise<RecommendationProtocolSourceAdapterRecordReadResult<TNormalizedRecord>> => {
      const providerResult = normalizeProviderRecordReadResultShape<TRecord>(
        await safeInput.read(request),
        request,
        safeInput.maxRecordsPerRead
      );
      const mappedRecords = providerResult.records.map((record) =>
        mapRecord(withRecordDefaults(safeInput.recordDefaults, record))
      );

      return normalizedReadResult(mappedRecords, providerResult);
    }
  });
}

export function createActivityPubProviderActivitySourceAdapter(
  input: RecommendationActivityPubProviderActivitySourceAdapterInput
): RecommendationSourceAdapter {
  return createMappedProviderRecordSourceAdapter<
    RecommendationActivityPubProviderActivitySourceRecord,
    RecommendationActivityPubNormalizedEvent
  >(
    input,
    {
      adapterId: ACTIVITYPUB_PROVIDER_RECORD_RECOMMENDATION_SOURCE_ADAPTER_ID,
      sourceSystem: DEFAULT_ACTIVITYPUB_PROVIDER_RECORD_SOURCE_SYSTEM
    },
    createActivityPubRecommendationSourceAdapter,
    mapActivityPubProviderActivityToNormalizedEvent
  );
}

export function createMastodonProviderStatusSourceAdapter(
  input: RecommendationMastodonProviderStatusSourceAdapterInput
): RecommendationSourceAdapter {
  return createMappedProviderRecordSourceAdapter<
    RecommendationMastodonProviderStatusSourceRecord,
    RecommendationActivityPubNormalizedEvent
  >(
    input,
    {
      adapterId: MASTODON_PROVIDER_STATUS_RECOMMENDATION_SOURCE_ADAPTER_ID,
      sourceSystem: DEFAULT_MASTODON_PROVIDER_STATUS_SOURCE_SYSTEM
    },
    createActivityPubRecommendationSourceAdapter,
    mapMastodonProviderStatusToActivityPubNormalizedEvent
  );
}

export function createAtprotoProviderRecordSourceAdapter(
  input: RecommendationAtprotoProviderRecordSourceAdapterInput
): RecommendationSourceAdapter {
  return createMappedProviderRecordSourceAdapter<
    RecommendationAtprotoProviderRecordSourceRecord,
    RecommendationAtprotoNormalizedRecordEvent
  >(
    input,
    {
      adapterId: ATPROTO_PROVIDER_RECORD_RECOMMENDATION_SOURCE_ADAPTER_ID,
      sourceSystem: DEFAULT_ATPROTO_PROVIDER_RECORD_SOURCE_SYSTEM
    },
    createAtprotoRecommendationSourceAdapter,
    mapAtprotoProviderRecordToNormalizedEvent
  );
}
