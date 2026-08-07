import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";
import type {
  RecommendationProcessingBoundary,
  RecommendationStorageAuthority
} from "./storage-authority.js";
import type { RecommendationStateStorageAdapterManifest } from "./state-placement-policy.js";

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
  /**
   * Required placement declaration for this adapter. Every public persistence
   * entry point validates it before invoking adapter I/O.
   */
  readonly storageManifest: RecommendationStateStorageAdapterManifest;
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
   * Optional assertion about the destination authority. When supplied it must
   * exactly match the adapter manifest; omission never overrides the manifest.
   */
  storageAuthority?: RecommendationStorageAuthority;
  /**
   * Optional assertion about the processing boundary. When supplied it must
   * exactly match the adapter manifest and storageAuthority must also be supplied.
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
