import type { CooccurrenceGraph } from "./cooccurrence-graph.js";

export interface CommunityResult {
  nodeToCommunity: Map<string, number>;
}

export function runLouvain(graph: CooccurrenceGraph): CommunityResult {
  const nodeToCommunity = new Map<string, number>();

  let communityId = 0;

  for (const node of graph.getNodes()) {
    nodeToCommunity.set(node, communityId++);
  }

  let improved = true;

  while (improved) {
    improved = false;

    for (const node of graph.getNodes()) {
      const neighbors = graph.getNeighbors(node);
      if (!neighbors) continue;

      let bestCommunity = nodeToCommunity.get(node)!;
      let bestScore = 0;

      for (const [neighbor, edge] of neighbors) {
        const neighborCommunity = nodeToCommunity.get(neighbor);
        if (neighborCommunity === undefined) continue;

        const score = edge.weight;

        if (score > bestScore) {
          bestScore = score;
          bestCommunity = neighborCommunity;
        }
      }

      if (bestCommunity !== nodeToCommunity.get(node)) {
        nodeToCommunity.set(node, bestCommunity);
        improved = true;
      }
    }
  }

  return { nodeToCommunity };
}
