import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import type { RecommendationProfileSnapshot } from "./profile-store.js";

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

export interface RecommendationProfilePersistenceWriteInput extends RecommendationProfileStoreRecordInput {}

export interface RecommendationProfilePersistenceDeleteInput {
  intent: RecommendationDerivedDataDeletionIntent;
  namespace?: string;
  salt?: string;
}
