import { normalizeHashtag } from "../normalization/hashtags.js";
import type { ClusterIndex } from "./index.js";

export function resolveClustersFromHashtag(
  hashtag: string,
  index: ClusterIndex
): readonly string[] {
  const normalized = normalizeHashtag(hashtag);
  if (!normalized) return Object.freeze([]);

  const excluded = index.excludedHashtagToClusters.get(normalized);
  if (excluded && excluded.length > 0) {
    return Object.freeze([]);
  }

  return index.hashtagToClusters.get(normalized) ?? Object.freeze([]);
}
