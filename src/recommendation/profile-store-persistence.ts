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
   * Placement declaration for this adapter. It is optional only for source-level
   * structural compatibility with pre-policy adapters; every public persistence
   * entry point rejects an adapter that omits it before any I/O occurs.
   */
  readonly storageManifest?: RecommendationStateStorageAdapterManifest;
  readProfileRecord(subjectKey: string): Promise<unknown | null | undefined>;
  writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void | RecommendationProfileStoreRecord>;
  deleteProfileRecord(subjectKey: string): Promise<void>;
}

export interface RecommendationProfilePersistenceReadInput extends RecommendationProfileSubjectKeyInput {
  now?: string;
  deleteExpiredRecord?: boolean;
}

export interface RecommendationProfilePersistenceWriteInput extends RecommendationProfileStoreRecordInput {
  /** Optional assertion that must exactly match the adapter manifest. */
  storageAuthority?: RecommendationStorageAuthority;
  /** Optional assertion that must exactly match the adapter manifest. */
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
