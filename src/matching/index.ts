import { normalizeHashtag, normalizeString } from "../normalization/hashtags.js";
import type { InterestCluster, InterestClusterDataset } from "../types/schema.js";

export interface ClusterIndex {
  readonly clusterById: ReadonlyMap<string, Readonly<InterestCluster>>;
  readonly hashtagToClusters: ReadonlyMap<string, readonly string[]>;
  readonly excludedHashtagToClusters: ReadonlyMap<string, readonly string[]>;
  readonly keywordToClusters: ReadonlyMap<string, readonly string[]>;
  readonly negativeKeywordToClusters: ReadonlyMap<string, readonly string[]>;
}

function addToMultiMap(map: Map<string, Set<string>>, key: string, clusterId: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(clusterId);
    return;
  }
  map.set(key, new Set([clusterId]));
}

function finalizeMultiMap(map: Map<string, Set<string>>): ReadonlyMap<string, readonly string[]> {
  return new Map(Array.from(map.entries(), ([key, value]) => [key, Object.freeze(Array.from(value).sort())]));
}

export function buildClusterIndex(dataset: Readonly<InterestClusterDataset>): ClusterIndex {
  const clusterById = new Map<string, Readonly<InterestCluster>>();
  const hashtagToClusters = new Map<string, Set<string>>();
  const excludedHashtagToClusters = new Map<string, Set<string>>();
  const keywordToClusters = new Map<string, Set<string>>();
  const negativeKeywordToClusters = new Map<string, Set<string>>();

  for (const cluster of dataset.clusters) {
    clusterById.set(cluster.id, cluster);

    for (const hashtag of cluster.hashtags.anchor) {
      const normalized = normalizeHashtag(hashtag);
      if (normalized) addToMultiMap(hashtagToClusters, normalized, cluster.id);
    }
    for (const hashtag of cluster.hashtags.aliases) {
      const normalized = normalizeHashtag(hashtag);
      if (normalized) addToMultiMap(hashtagToClusters, normalized, cluster.id);
    }
    for (const hashtag of cluster.hashtags.adjacent) {
      const normalized = normalizeHashtag(hashtag);
      if (normalized) addToMultiMap(hashtagToClusters, normalized, cluster.id);
    }
    for (const hashtag of cluster.hashtags.excluded) {
      const normalized = normalizeHashtag(hashtag);
      if (normalized) addToMultiMap(excludedHashtagToClusters, normalized, cluster.id);
    }

    for (const keyword of cluster.keywords.high_value) {
      const normalized = normalizeString(keyword);
      if (normalized) addToMultiMap(keywordToClusters, normalized, cluster.id);
    }
    for (const keyword of cluster.keywords.secondary) {
      const normalized = normalizeString(keyword);
      if (normalized) addToMultiMap(keywordToClusters, normalized, cluster.id);
    }
    for (const keyword of cluster.keywords.negative) {
      const normalized = normalizeString(keyword);
      if (normalized) addToMultiMap(negativeKeywordToClusters, normalized, cluster.id);
    }
  }

  return {
    clusterById: new Map(clusterById),
    hashtagToClusters: finalizeMultiMap(hashtagToClusters),
    excludedHashtagToClusters: finalizeMultiMap(excludedHashtagToClusters),
    keywordToClusters: finalizeMultiMap(keywordToClusters),
    negativeKeywordToClusters: finalizeMultiMap(negativeKeywordToClusters)
  };
}
