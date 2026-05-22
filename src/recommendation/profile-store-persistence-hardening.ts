import {
  RECOMMENDATION_DATA_USES,
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationDataUse,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import { requireRecommendationConsent } from "./consent-enforcement.js";
import {
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  type RecommendationInterestPrivacyBoundary
} from "./interest-signal.js";
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
  normalizeRecommendationProfileStoreRecord
} from "./profile-store-persistence-record.js";
import { createEmptyRecommendationProfileSnapshot } from "./profile-store-persistence-snapshot.js";
import type { RecommendationProfileEntry, RecommendationProfileSnapshot } from "./profile-store.js";

export const RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS = [
  "local_app",
  "user_pod",
  "server_profile",
  "provider_hosted",
  "ephemeral_session"
] as const;

export const RECOMMENDATION_PROFILE_PERSISTENCE_VERIFICATION_CONSISTENCIES = ["strong", "eventual"] as const;

export type RecommendationProfilePersistenceStorageTarget = typeof RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS[number];
export type RecommendationProfilePersistenceVerificationConsistency = typeof RECOMMENDATION_PROFILE_PERSISTENCE_VERIFICATION_CONSISTENCIES[number];

export type RecommendationProfilePersistenceOperation = "read" | "write" | "delete";

export type RecommendationProfilePersistenceReasonCode =
  | "persistence.deny.aggregate_subject_profile"
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
  policy?: RecommendationConsentPolicy | null | undefined;
  dataUse?: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
}

export interface HardenedRecommendationProfilePersistenceWriteInput
  extends RecommendationProfilePersistenceWriteInput,
    RecommendationProfilePersistenceConsentInput {
  verifyWrite?: boolean;
  deleteOnVerificationFailure?: boolean;
  verificationConsistency?: RecommendationProfilePersistenceVerificationConsistency;
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
  verificationConsistency: RecommendationProfilePersistenceVerificationConsistency;
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
const VERIFICATION_CONSISTENCY_SET = new Set<string>(RECOMMENDATION_PROFILE_PERSISTENCE_VERIFICATION_CONSISTENCIES);
const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);

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

function timestampMillis(value: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new TypeError("Invalid recommendation profile timestamp.");
  }

  return millis;
}

function timestampsEqual(left: string, right: string): boolean {
  return timestampMillis(left) === timestampMillis(right);
}

function optionalTimestampsEqual(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return timestampsEqual(left, right);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function profileEntriesEqual(left: RecommendationProfileEntry, right: RecommendationProfileEntry): boolean {
  return (
    left.target.kind === right.target.kind &&
    left.target.key === right.target.key &&
    Object.is(left.score, right.score) &&
    Object.is(left.confidence, right.confidence) &&
    left.signalCount === right.signalCount &&
    left.positiveSignalCount === right.positiveSignalCount &&
    left.negativeSignalCount === right.negativeSignalCount &&
    left.neutralSignalCount === right.neutralSignalCount &&
    arraysEqual(left.privacyBoundaries, right.privacyBoundaries) &&
    arraysEqual(left.protocols, right.protocols) &&
    arraysEqual(left.sourceVisibilities, right.sourceVisibilities) &&
    timestampsEqual(left.updatedAt, right.updatedAt) &&
    optionalTimestampsEqual(left.expiresAt, right.expiresAt)
  );
}

function profilesEqual(left: RecommendationProfileSnapshot, right: RecommendationProfileSnapshot): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.signalCount === right.signalCount &&
    timestampsEqual(left.updatedAt, right.updatedAt) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const rightEntry = right.entries[index];
      return rightEntry !== undefined && profileEntriesEqual(entry, rightEntry);
    })
  );
}

function profileRecordsEqual(left: RecommendationProfileStoreRecord, right: RecommendationProfileStoreRecord): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.subjectKey === right.subjectKey &&
    timestampsEqual(left.writtenAt, right.writtenAt) &&
    optionalTimestampsEqual(left.expiresAt, right.expiresAt) &&
    profilesEqual(left.profile, right.profile)
  );
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

function normalizeVerificationConsistency(
  value: unknown,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): RecommendationProfilePersistenceVerificationConsistency {
  if (value === undefined) {
    return storageTarget === "local_app" ? "strong" : "eventual";
  }

  if (typeof value !== "string" || !VERIFICATION_CONSISTENCY_SET.has(value)) {
    throw new TypeError("Invalid recommendation profile persistence verification consistency.");
  }

  return value as RecommendationProfilePersistenceVerificationConsistency;
}

function normalizeOptionalBoolean(value: unknown, message: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(message);
  }

  return value;
}

function normalizeDataUse(value: unknown): RecommendationDataUse {
  if (typeof value !== "string" || !DATA_USE_SET.has(value)) {
    throw new TypeError("Invalid recommendation profile persistence data use.");
  }

  return value as RecommendationDataUse;
}

function normalizePrivacyBoundary(value: unknown): RecommendationInterestPrivacyBoundary {
  if (typeof value !== "string" || !PRIVACY_BOUNDARY_SET.has(value)) {
    throw new TypeError("Invalid recommendation profile persistence privacy boundary.");
  }

  return value as RecommendationInterestPrivacyBoundary;
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

function shouldVerifyWrite(
  verifyWrite: boolean | undefined,
  consistency: RecommendationProfilePersistenceVerificationConsistency
): boolean {
  if (verifyWrite !== undefined) {
    return verifyWrite;
  }

  return consistency === "strong";
}

function shouldCleanupVerificationFailure(
  deleteOnVerificationFailure: boolean | undefined,
  consistency: RecommendationProfilePersistenceVerificationConsistency
): boolean {
  return deleteOnVerificationFailure === true && consistency === "strong";
}

function assertNoAggregateOnlyProfileState(
  profile: RecommendationProfileSnapshot,
  storageTarget: RecommendationProfilePersistenceStorageTarget
): void {
  if (profile.entries.some((entry) => entry.privacyBoundaries.includes("aggregate_only"))) {
    throw createPersistenceError("write", "persistence.deny.aggregate_subject_profile", storageTarget);
  }
}

async function enforceWriteConsent(
  input: HardenedRecommendationProfilePersistenceWriteInput,
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  profile: RecommendationProfileSnapshot
): Promise<RecommendationConsentEvaluation | undefined> {
  if (storageTarget === "ephemeral_session") {
    throw createPersistenceError("write", "persistence.deny.ephemeral_durable_write", storageTarget);
  }

  assertNoAggregateOnlyProfileState(profile, storageTarget);

  const dataUse = normalizeDataUse(input.dataUse ?? DEFAULT_DATA_USE);
  const privacyBoundary = normalizePrivacyBoundary(input.privacyBoundary ?? DEFAULT_PRIVACY_BOUNDARY);
  if (privacyBoundary === "aggregate_only") {
    throw createPersistenceError("write", "persistence.deny.aggregate_subject_profile", storageTarget);
  }

  const serverSideProcessing = requiresServerSideConsent(storageTarget) || privacyBoundary === "server_allowed";
  const policy = input.policy;
  if (policy === undefined || policy === null) {
    if (serverSideProcessing) {
      throw createPersistenceError("write", "persistence.deny.server_consent_required", storageTarget);
    }
    return undefined;
  }

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
      serverSideProcessing
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

async function cleanupConfirmedVerificationFailure(
  adapter: RecommendationProfilePersistenceAdapter,
  subjectKey: string,
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  shouldCleanup: boolean
): Promise<void> {
  if (shouldCleanup) {
    await deleteRecordBestEffort(adapter, subjectKey, storageTarget);
  }
}

async function verifyWrittenRecord(
  adapter: RecommendationProfilePersistenceAdapter,
  record: RecommendationProfileStoreRecord,
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  shouldCleanup: boolean
): Promise<void> {
  let raw: unknown;
  try {
    raw = await adapter.readProfileRecord(record.subjectKey);
  } catch {
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }

  let normalized: RecommendationProfileStoreRecord | null;
  try {
    normalized = normalizeRecommendationProfileStoreRecord(raw, { pruneExpiredEntries: false });
  } catch {
    await cleanupConfirmedVerificationFailure(adapter, record.subjectKey, storageTarget, shouldCleanup);
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }

  if (normalized === null || !profileRecordsEqual(normalized, record)) {
    await cleanupConfirmedVerificationFailure(adapter, record.subjectKey, storageTarget, shouldCleanup);
    throw createPersistenceError("write", "persistence.error.write_verification_failed", storageTarget);
  }
}

export async function writeRecommendationProfileStoreRecordSafely(
  adapter: RecommendationProfilePersistenceAdapter,
  input: HardenedRecommendationProfilePersistenceWriteInput
): Promise<HardenedRecommendationProfilePersistenceWriteResult> {
  assertPersistenceAdapter(adapter);
  const storageTarget = normalizeStorageTarget(input.storageTarget);
  const verificationConsistency = normalizeVerificationConsistency(input.verificationConsistency, storageTarget);
  const verifyWrite = normalizeOptionalBoolean(input.verifyWrite, "Invalid recommendation profile persistence verification option.");
  const deleteOnVerificationFailure = normalizeOptionalBoolean(
    input.deleteOnVerificationFailure,
    "Invalid recommendation profile persistence cleanup option."
  );
  const shouldVerify = shouldVerifyWrite(verifyWrite, verificationConsistency);
  const shouldCleanup = shouldCleanupVerificationFailure(deleteOnVerificationFailure, verificationConsistency);
  const record = createRecommendationProfileStoreRecord(input);
  const consent = await enforceWriteConsent(input, storageTarget, record.profile);

  try {
    await adapter.writeProfileRecord(record);
  } catch {
    throw createPersistenceError("write", "persistence.error.adapter_write_failed", storageTarget);
  }

  if (shouldVerify) {
    await verifyWrittenRecord(adapter, record, storageTarget, shouldCleanup);
  }

  return Object.freeze({
    record,
    storageTarget,
    verified: shouldVerify,
    verificationConsistency,
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
