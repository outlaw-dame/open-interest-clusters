import type { LinkedEntity, EntityGraphResolver, ClusterEntityMatch } from "./types.js";
import type { InterestCluster } from "../types/schema.js";

function collectClusterEntityIds(cluster: InterestCluster): string[] {
  if (!cluster.entities) return [];

  const groups = [
    cluster.entities.brands,
    cluster.entities.products,
    cluster.entities.people_or_orgs,
    cluster.entities.custom
  ];

  const ids: string[] = [];

  for (const group of groups) {
    if (!group) continue;
    for (const entity of group) {
      if (entity.wikidata_id) ids.push(entity.wikidata_id);
    }
  }

  return ids;
}

export async function mapEntitiesToClusters(
  entities: LinkedEntity[],
  clusters: readonly InterestCluster[],
  resolver?: EntityGraphResolver
): Promise<ClusterEntityMatch[]> {
  const directMap = new Map<string, string[]>();

  for (const cluster of clusters) {
    const ids = collectClusterEntityIds(cluster);
    directMap.set(cluster.id, ids);
  }

  const entityIds = entities
    .map((e) => e.wikidataId)
    .filter((id): id is string => Boolean(id));

  let relations = [];
  if (resolver && entityIds.length > 0) {
    relations = await resolver.resolveNeighbors(entityIds);
  }

  const results: ClusterEntityMatch[] = [];

  for (const cluster of clusters) {
    const clusterIds = directMap.get(cluster.id) ?? [];

    let score = 0;
    const matched: string[] = [];
    const relationHits = [];

    // direct match
    for (const entity of entities) {
      if (entity.wikidataId && clusterIds.includes(entity.wikidataId)) {
        score += 5;
        matched.push(entity.wikidataId);
      }
    }

    // relation match
    for (const edge of relations) {
      if (clusterIds.includes(edge.targetId)) {
        score += edge.weight;
        relationHits.push(edge);
      }
    }

    if (score > 0) {
      results.push({
        clusterId: cluster.id,
        score,
        matchedEntityIds: matched,
        relationHits
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
