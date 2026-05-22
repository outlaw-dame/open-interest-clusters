import {
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationDataUse,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import { requireRecommendationConsent } from "./consent-enforcement.js";
import type { RecommendationInterestPrivacyBoundary } from "./interest-signal.js";
import type {
  RecommendationProfilePersistenceAdapter,
  RecommendationProfilePersistenceDeleteInput,
  RecommendationProfilePersistenceReadInput,
  RecommendationProfilePersistenceWriteInput,
  RecommendationProfileStoreRecord
} from "./profile-store-persistence.js";
import {
  assertValidRecommendationProfileSubjectId,
  createRecommendationProfileSubjectKey
} from "./profile-store-persistence-key.js";
import {
  createRecommendationProfileStoreRecord,
  normalizeRecommendationProfileStoreRecord,
  serializeRecommendationProfileStoreRecord
} from "./profile-store-persistence-record.js";
import { createEmptyRecommendationProfileSnapshot } from "./profile-store-persistence-snapshot.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";

export const RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS = [
  "local_app",
  "user_pod",
  "server_profile",
  "provider_hosted",
  "ephemeral_session"
] as const;

export type RecommendationProfilePersistenceStorageTarget = typeof RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS[number];

export type RecommendationProfilePersistenceOperation = "read" | "write" | "delete";

export type RecommendationProfilePersistenceReasonCode =
  | "persistence.deny.ephemeral_durable_write"
  | "persistence.deny.server_consent_required"
  | "persistence.error.adapter_read_failed"
  | "persistence.error.adapter_write_failed"
  | "persistence.error.adapter_delete_failed"
  | "persistence.error.invalid_record"
  | "persistence.error.write_verification_failed"
  | "persistence.error.write_verification_cleanup_failed";

export interface RecommendationProfilePersistenceConsentInput {
  storageTarget?: RecommendationProfilePersistenceStorageTarget;
  policy?: RecommendationConsentPolicy | null;
  dataUse?: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
}

export interface HardenedRecommendationProfilePersistenceWriteInput
  extends RecommendationProfilePersistenceWriteInput,
    RecommendationProfilePersistenceConsentInput {
  verifyWrite?: boolean;
  deleteOnVerificationFailure?: boolean;
}

export interface HardenedRecommendationProfilePersistenceReadInput extends RecommendationProfilePersistenceReadInput {
  storageTarget?: RecommendationProfilePersistenceStorageTarget;
}

export interface HardenedRecommendationProfilePersistenceDeleteInput extends RecommendationProfilePersistenceDeleteInput {
  storageTarget?: RecommendationProfilePersistenceStorageTarget;
}

export interface HardenedRecommendationProfilePersistenceWriteResult {
  record: RecommendationProfileStoreRecord;
  storageTarget: RecommendationProfilePersistenceStorageTarget;
  verified: boolean;
  consent?: RecommendationConsentEvaluation;
}

export class RecommendationProfilePersistenceError extends Error {
  readonly operation: RecommendationProfilePersistenceOperation;
  readonly reason: RecommendationProfilePersistenceReasonCode;
  readonly storageTarget: RecommendationProfilePersistenceStorageTarget;

  constructor(
    operation: RecommendationProfilePersistenceOperation,
    reason: RecommendationProfilePersistenceReasonCode,
    storageTarget: RecommendationProfilePersistenceStorageTarget
  ) {
    super("Recommendation profile persistence operation failed.");
    this.name = "RecommendationProfilePersistenceError";
    this.operation = operation;
    this.reason = reason;
    this.storageTarget = storageTarget;
  }
}

const DEFAULT_STORAGE_TARGET: RecommendationProfilePersistenceStorageTarget = "local_app";
const DEFAULT_DATA_USE: RecommendationDataUse = "local_personalization";
const DEFAULT_PRIVACY_BOUNDARY: RecommendationInterestPrivacyBoundary = "local_only";
const PERSISTENCE_PROTOCOL: RecommendationProtocol = "app_local";
const PERSISTENCE_VISIBILITY: RecommendationSourceVisibility = "local_only";
const STORAGE_TARGET_SET = new Set<string>(RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertTimestamp(value: unknown): void {
  if (!isNonEmptyString(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("Invalid recommendation profile timestamp.");
  }
}

function normalizeStorageTarget(value: unknown): RecommendationProfilePersistenceStorageTarget {
  if (value === undefined) {
    return DEFAULT_STORAGE_TARGET;
  }

  if (typeof value !== "string" || !STORAGE_TARGET_SET.has(value)) {
    throw new TypeError("Invalid recommendation profile persistence storage target.");
  }

  return value as RecommendationProfilePersistenceStorageTarget;
}

function assertPersistenceAdapter(adapter: RecommendationProfilePersistenceAdapter): void {
  if (
    !isObject(adapter) ||
    typeof adapter.readProfileRecord !== "function" ||
    typeof adapter.writeProfileRecord !== "function" ||
    typeof adapter.deleteProfileRecord !== "function"
  ) {
    throw new TypeError("Invalid recommendation profile persistence adapter.");
  }
}

function assertProfileDeletionIntent(intent: RecommendationDerivedDataDeletionIntent): void {
  if (
    !isObject(intent) ||
    !isNonEmptyString(intent.subjectId) ||
    intent.scope !== "recommendation_derived_data" ||
    !Array.isArray(intent.targets) ||
    !intent.targets.includes("profile")
  ) {
    throw new TypeError("Invalid recommendation profile deletion intent.");
  }

  assertValidRecommendationProfileSubjectId(intent.subjectId);
  assertTimestamp(intent.requestedAt);
}

function requiresServerSideConsent(storageTarget: RecommendationProfilePersistenceStorageTarget): boolean {
  return storageTarget === "user_pod" || storageTarget === "server_profile" || storageTarget === "provider_hosted";
}

function createPersistenceError(
  operation: RecommendationProfilePersistenceOperation,
  reason: RecommendationProfilePersistenceReasonCode,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): RecommendationProfilePersistenceError {
  return new RecommendationProfilePersistenceError(operation, reason, storageTarget);
}

async function enforceWriteConsent(
  input: HardenedRecommendationProfilePersistenceWriteInput,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): Promise<RecommendationConsentEvaluation | undefined> {
  if (storageTarget === "ephemeral_session") {
    throw createPersistenceError("write", "persistence.deny.ephemeral_durable_write", storageTarget);
  }

  const policy = input.policy;
  if (policy === undefined || policy === null) {
    if (requiresServerSideConsent(storageTarget)) {
      throw createPersistenceError("write", "persistence.deny.server_consent_required", storageTarget);
    }
    return undefined;
  }

  const dataUse = input.dataUse ?? DEFAULT_DATA_USE;
  const privacyBoundary = input.privacyBoundary ?? DEFAULT_PRIVACY_BOUNDARY;
  return requireRecommendationConsent(
    policy,
    Object.freeze({
      subjectId: input.subjectId,
      dataUse,
      protocol: PERSISTENCE_PROTOCOL,
      sourceVisibility: PERSISTENCE_VISIBILITY,
      accessBasis: "owner",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: requiresServerSideConsent(storageTarget) || privacyBoundary === "server_allowed"
    })
  );
}

async function deleteRecordBestEffort(
  adapter: RecommendationProfilePersistenceAdapter,
  subjectKey: string,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): Promise<void> {
  try {
    await adapter.deleteProfileRecord(subjectKey);
  } catch {
    throw createPersistenceError("write", "persistence.error.write_verification_cleanup_failed", storageTarget);
  }
}

async function verifyWrittenRecord(
  adapter: RecommendationProfilePersistenceAdapter,
  record: RecommendationProfileStoreRecord,
  input: HardenedRecommendationProfilePersistenceWriteInput,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): Promise<void> {
  let raw: unknown;
  try {
    raw = await adapter.readProfileRecord(record.subjectKey);
  } catch {
    if (input.deleteOnVerificationFailure !== false) {
      await deleteRecordBestEffort(adapter, record.subjectKey, storageTarget);
    }
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }

  let normalized: RecommendationProfileStoreRecord | null;
  try {
    normalized = normalizeRecommendationProfileStoreRecord(raw, { pruneExpiredEntries: false });
  } catch {
    if (input.deleteOnVerificationFailure !== false) {
      await deleteRecordBestEffort(adapter, record.subjectKey, storageTarget);
    }
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }

  if (normalized === null || serializeRecommendationProfileStoreRecord(normalized) !== serializeRecommendationProfileStoreRecord(record)) {
    if (input.deleteOnVerificationFailure !== false) {
      await deleteRecordBestEffort(adapter, record.subjectKey, storageTarget);
    }
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }
}

export async function writeRecommendationProfileStoreRecordSafely(
  adapter: RecommendationProfilePersistenceAdapter,
  input: HardenedRecommendationProfilePersistenceWriteInput
): Promise<HardenedRecommendationProfilePersistenceWriteResult> {
  assertPersistenceAdapter(adapter);
  const storageTarget = normalizeStorageTarget(input.storageTarget);
  const consent = await enforceWriteConsent(input, storageTarget);
  const record = createRecommendationProfileStoreRecord(input);

  try {
    await adapter.writeProfileRecord(record);
  } catch {
    throw createPersistenceError("write", "persistence.error.adapter_write_failed", storageTarget);
  }

  const shouldVerify = input.verifyWrite !== false;
  if (shouldVerify) {
    await verifyWrittenRecord(adapter, record, input, storageTarget);
  }

  return Object.freeze({
    record,
    storageTarget,
    verified: shouldVerify,
    ...(consent === undefined ? {} : { consent })
  });
}

export async function readRecommendationProfileStoreRecordSafely(
  adapter: RecommendationProfilePersistenceAdapter,
  input: HardenedRecommendationProfilePersistenceReadInput
): Promise<RecommendationProfileStoreRecord | null> {
  assertPersistenceAdapter(adapter);
  const storageTarget = normalizeStorageTarget(input.storageTarget);
  const subjectKey = createRecommendationProfileSubjectKey(input);
  let raw: unknown;

  try {
    raw = await adapter.readProfileRecord(subjectKey);
  } catch {
    throw createPersistenceError("read", "persistence.error.adapter_read_failed", storageTarget);
  }

  if (raw === null || raw === undefined) {
    return null;
  }

  let record: RecommendationProfileStoreRecord | null;
  try {
    record = normalizeRecommendationProfileStoreRecord(raw, input);
  } catch {
    throw createPersistenceError("read", "persistence.error.invalid_record", storageTarget);
  }

  if (record === null && input.deleteExpiredRecord === true) {
    try {
      await adapter.deleteProfileRecord(subjectKey);
    } catch {
      throw createPersistenceError("delete", "persistence.error.adapter_delete_failed", storageTarget);
    }
  }

  return record;
}

export async function deleteRecommendationProfileStoreRecordSafely(
  adapter: RecommendationProfilePersistenceAdapter,
  input: HardenedRecommendationProfilePersistenceDeleteInput
): Promise<RecommendationProfileSnapshot> {
  assertPersistenceAdapter(adapter);
  const storageTarget = normalizeStorageTarget(input.storageTarget);
  assertProfileDeletionIntent(input.intent);
  const subjectKey = createRecommendationProfileSubjectKey({
    subjectId: input.intent.subjectId,
    ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    ...(input.salt === undefined ? {} : { salt: input.salt })
  });

  try {
    await adapter.deleteProfileRecord(subjectKey);
  } catch {
    throw createPersistenceError("delete", "persistence.error.adapter_delete_failed", storageTarget);
  }

  return createEmptyRecommendationProfileSnapshot(input.intent.requestedAt);
}
