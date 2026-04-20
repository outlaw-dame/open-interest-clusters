import type { ClusterIndex } from "../matching/index.js";
import type { CommunityResult } from "./louvain.js";

export function mapCommunitiesToClusters(
  communities: CommunityResult,
  index: ClusterIndex
): Map<number, string[]> {
  const communityToClusters = new Map<number, Set<string>>();

  for (const [node, communityId] of communities.nodeToCommunity) {
    const clusters = index.hashtagToClusters.get(node);
    if (!clusters) continue;

    let set = communityToClusters.get(communityId);
    if (!set) {
      set = new Set();
      communityToClusters.set(communityId, set);
    }

    for (const clusterId of clusters) {
      set.add(clusterId);
    }
  }

  return new Map(
    Array.from(communityToClusters.entries(), ([k, v]) => [k, Array.from(v)])
  );
}
