import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
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
import { createEmptyRecommendationProfileSnapshot } from "./profile-store-persistence-snapshot.js";
import {
  createRecommendationProfileStoreRecord,
  normalizeRecommendationProfileStoreRecord
} from "./profile-store-persistence-record.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import {
  evaluateRecommendationStorageAuthority,
  isRecommendationProcessingBoundary,
  isRecommendationStorageAuthority,
  type RecommendationProcessingBoundary,
  type RecommendationStorageAuthority
} from "./storage-authority.js";

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

function resolveProfileWriteAuthority(input: RecommendationProfilePersistenceWriteInput): {
  storageAuthority: RecommendationStorageAuthority;
  processingBoundary: RecommendationProcessingBoundary;
} {
  const hasAuthority = input.storageAuthority !== undefined;
  const hasBoundary = input.processingBoundary !== undefined;
  if (hasAuthority !== hasBoundary) {
    throw new TypeError(
      "Recommendation profile storage authority and processing boundary must be supplied together."
    );
  }

  if (!hasAuthority && !hasBoundary) {
    return Object.freeze({
      storageAuthority: "device_owned",
      processingBoundary: "local_only"
    });
  }

  if (!isRecommendationStorageAuthority(input.storageAuthority)) {
    throw new TypeError("Invalid recommendation profile storage authority.");
  }
  if (!isRecommendationProcessingBoundary(input.processingBoundary)) {
    throw new TypeError("Invalid recommendation profile processing boundary.");
  }

  return Object.freeze({
    storageAuthority: input.storageAuthority,
    processingBoundary: input.processingBoundary
  });
}

export async function writeRecommendationProfileStoreRecord(
  adapter: RecommendationProfilePersistenceAdapter,
  input: RecommendationProfilePersistenceWriteInput
): Promise<RecommendationProfileStoreRecord> {
  assertPersistenceAdapter(adapter);
  const authority = resolveProfileWriteAuthority(input);
  const decision = evaluateRecommendationStorageAuthority({
    authority: authority.storageAuthority,
    processingBoundary: authority.processingBoundary,
    subjectLevel: true
  });
  if (decision.decision === "deny") {
    throw new TypeError(`Recommendation profile persistence denied: ${decision.reason}.`);
  }

  const record = createRecommendationProfileStoreRecord(input);
  await adapter.writeProfileRecord(record);
  return record;
}

export async function readRecommendationProfileStoreRecord(
  adapter: RecommendationProfilePersistenceAdapter,
  input: RecommendationProfilePersistenceReadInput
): Promise<RecommendationProfileStoreRecord | null> {
  assertPersistenceAdapter(adapter);
  const subjectKey = createRecommendationProfileSubjectKey(input);
  const raw = await adapter.readProfileRecord(subjectKey);
  if (raw === null || raw === undefined) {
    return null;
  }

  const record = normalizeRecommendationProfileStoreRecord(raw, input);
  if (record === null && input.deleteExpiredRecord === true) {
    await adapter.deleteProfileRecord(subjectKey);
  }

  return record;
}

export async function deleteRecommendationProfileStoreRecord(
  adapter: RecommendationProfilePersistenceAdapter,
  input: RecommendationProfilePersistenceDeleteInput
): Promise<RecommendationProfileSnapshot> {
  assertPersistenceAdapter(adapter);
  assertProfileDeletionIntent(input.intent);
  await adapter.deleteProfileRecord(
    createRecommendationProfileSubjectKey({
      subjectId: input.intent.subjectId,
      ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
      ...(input.salt === undefined ? {} : { salt: input.salt })
    })
  );
  return createEmptyRecommendationProfileSnapshot(input.intent.requestedAt);
}