import { normalizeHashtag, normalizeString } from "../normalization/hashtags.js";
import type { ClusterIndex } from "./index.js";

export interface MatchResult {
  readonly clusterId: string;
  readonly score: number;
}

export function matchTextToClusters(
  text: string,
  hashtags: readonly string[],
  index: ClusterIndex
): readonly MatchResult[] {
  const scores = new Map<string, number>();

  // Normalize full text once
  const normalizedText = normalizeString(text);

  // 1. Hashtag signals (strong)
  for (const tag of hashtags) {
    const normalized = normalizeHashtag(tag);
    if (!normalized) continue;

    // Skip excluded hashtags
    if (index.excludedHashtagToClusters.has(normalized)) continue;

    const clusters = index.hashtagToClusters.get(normalized);
    if (!clusters) continue;

    for (const clusterId of clusters) {
      scores.set(clusterId, (scores.get(clusterId) ?? 0) + 3);
    }
  }

  // 2. Keyword signals (phrase-based, not token split)
  for (const [keyword, clusters] of index.keywordToClusters.entries()) {
    if (!normalizedText.includes(keyword)) continue;

    for (const clusterId of clusters) {
      scores.set(clusterId, (scores.get(clusterId) ?? 0) + 1);
    }
  }

  // 3. Negative keyword suppression
  for (const [keyword, clusters] of index.negativeKeywordToClusters.entries()) {
    if (!normalizedText.includes(keyword)) continue;

    for (const clusterId of clusters) {
      scores.delete(clusterId);
    }
  }

  return Object.freeze(
    Array.from(scores.entries())
      .map(([clusterId, score]) => ({ clusterId, score }))
      .sort((a, b) => b.score - a.score)
  );
}
