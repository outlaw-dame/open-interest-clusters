import type { RecommendationDerivedDataDeletionIntent } from "./consent.js";
import {
  createInMemoryRecommendationProfileStore,
  type InMemoryRecommendationProfileStoreOptions,
  type RecommendationProfileSignalIngestInput,
  type RecommendationProfileSignalIngestResult,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStore
} from "./profile-store.js";

export interface RecommendationProfileSignalReplacementStore extends RecommendationProfileStore {
  replaceSignals(input: RecommendationProfileSignalIngestInput): Promise<RecommendationProfileSignalIngestResult>;
}

export function createInMemoryRecommendationProfileSignalReplacementStore(
  options: InMemoryRecommendationProfileStoreOptions = {}
): RecommendationProfileSignalReplacementStore {
  const stores = new Map<string, RecommendationProfileStore>();
  const createStore = (): RecommendationProfileStore => createInMemoryRecommendationProfileStore(options);

  function storeFor(subjectId: string): RecommendationProfileStore {
    const existing = stores.get(subjectId);
    if (existing !== undefined) return existing;
    const created = createStore();
    stores.set(subjectId, created);
    return created;
  }

  return Object.freeze({
    async ingestSignals(input: RecommendationProfileSignalIngestInput): Promise<RecommendationProfileSignalIngestResult> {
      return storeFor(input.subjectId).ingestSignals(input);
    },

    async readProfile(subjectId: string): Promise<RecommendationProfileSnapshot> {
      const existing = stores.get(subjectId);
      return (existing ?? createStore()).readProfile(subjectId);
    },

    async deleteProfile(intent: RecommendationDerivedDataDeletionIntent): Promise<RecommendationProfileSnapshot> {
      const existing = stores.get(intent.subjectId);
      const result = await (existing ?? createStore()).deleteProfile(intent);
      if (intent.targets.includes("profile")) stores.delete(intent.subjectId);
      return result;
    },

    async replaceSignals(input: RecommendationProfileSignalIngestInput): Promise<RecommendationProfileSignalIngestResult> {
      const replacement = createStore();
      const result = await replacement.ingestSignals(input);
      stores.set(input.subjectId, replacement);
      return result;
    }
  });
}
