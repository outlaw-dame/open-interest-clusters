import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import type {
  RecommendationProcessingBoundary,
  RecommendationStorageAuthority
} from "./storage-authority.js";

export const RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION = "recommendation-profile-store-record.v1" as const;
export const DEFAULT_RECOMMENDATION_PROFILE_SUBJECT_KEY_NAMESPACE = "recommendation-profile.v1" as const;

export interface RecommendationProfileSubjectKeyInput {
  subjectId: string;
  namespace?: string;
  salt?: string;
}

export interface RecommendationProfileStoreRecord {
  schemaVersion: typeof RECOMMENDATION_PROFILE_STORE_RECORD_SCHEMA_VERSION;
  subjectKey: string;
  writtenAt: string;
  profile: RecommendationProfileSnapshot;
  expiresAt?: string;
}

export interface RecommendationProfileStoreRecordInput extends RecommendationProfileSubjectKeyInput {
  profile: RecommendationProfileSnapshot;
  writtenAt: string;
  expiresAt?: string;
}

export interface RecommendationProfileStoreRecordParseOptions {
  now?: string;
  pruneExpiredEntries?: boolean;
}

export interface RecommendationProfilePersistenceAdapter {
  readProfileRecord(subjectKey: string): Promise<unknown | null | undefined>;
  writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void | RecommendationProfileStoreRecord>;
  deleteProfileRecord(subjectKey: string): Promise<void>;
}

export interface RecommendationProfilePersistenceReadInput extends RecommendationProfileSubjectKeyInput {
  now?: string;
  deleteExpiredRecord?: boolean;
}

export interface RecommendationProfilePersistenceWriteInput extends RecommendationProfileStoreRecordInput {
  /**
   * Ownership of the destination that will persist this subject-level profile.
   * Omitted legacy writes are treated as device-owned/local-only.
   */
  storageAuthority?: RecommendationStorageAuthority;
  /**
   * Processing and disclosure boundary for the destination.
   * Must be supplied together with storageAuthority for remote or aggregate writes.
   */
  processingBoundary?: RecommendationProcessingBoundary;
}

export interface RecommendationProfilePersistenceDeleteInput {
  intent: RecommendationDerivedDataDeletionIntent;
  namespace?: string;
  salt?: string;
}

export * from "./profile-store-persistence-key.js";
export * from "./profile-store-persistence-snapshot.js";
export * from "./profile-store-persistence-record.js";
export * from "./profile-store-persistence-operations.js";
export * from "./profile-store-persistence-hardening.js";
