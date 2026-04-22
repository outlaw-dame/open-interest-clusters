import type { InterestCluster } from "../types/schema.js";

export interface ClusterEntityIndex {
  clusterToEntities: Map<string, Set<string>>;
  entityToClusters: Map<string, Set<string>>;
}

export function buildClusterEntityIndex(clusters: readonly InterestCluster[]): ClusterEntityIndex {
  const clusterToEntities = new Map<string, Set<string>>();
  const entityToClusters = new Map<string, Set<string>>();

  for (const cluster of clusters) {
    const set = new Set<string>();

    const groups = [
      cluster.entities?.brands,
      cluster.entities?.products,
      cluster.entities?.people_or_orgs,
      cluster.entities?.custom
    ];

    for (const group of groups) {
      if (!group) continue;
      for (const entity of group) {
        if (!entity.wikidata_id) continue;
        set.add(entity.wikidata_id);

        let clustersSet = entityToClusters.get(entity.wikidata_id);
        if (!clustersSet) {
          clustersSet = new Set<string>();
          entityToClusters.set(entity.wikidata_id, clustersSet);
        }
        clustersSet.add(cluster.id);
      }
    }

    clusterToEntities.set(cluster.id, set);
  }

  return { clusterToEntities, entityToClusters };
}
