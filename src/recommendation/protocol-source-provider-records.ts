import type { RecommendationAtprotoNormalizedRecordEvent } from "./protocol-source-normalizers.js";

export interface RecommendationAtprotoProviderRecordMapInput {
  operation: RecommendationAtprotoNormalizedRecordEvent["operation"];
  repositoryDid: string;
  collection: RecommendationAtprotoNormalizedRecordEvent["collection"];
  atUri: string;
  observedAt: string;
}

export function mapAtprotoProviderRecordToNormalizedEvent(
  input: RecommendationAtprotoProviderRecordMapInput
): RecommendationAtprotoNormalizedRecordEvent {
  return Object.freeze({
    operation: input.operation,
    repositoryDid: input.repositoryDid,
    collection: input.collection,
    atUri: input.atUri,
    observedAt: input.observedAt
  });
}
