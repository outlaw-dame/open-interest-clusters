import { CooccurrenceGraph } from "./cooccurrence-graph.js";

export function pruneGraph(graph: CooccurrenceGraph, maxAgeMs: number): void {
  const now = Date.now();

  for (const node of graph.getNodes()) {
    const neighbors = graph.getNeighbors(node);
    if (!neighbors) continue;

    for (const [neighbor, edge] of neighbors.entries()) {
      if (now - edge.lastUpdated > maxAgeMs) {
        neighbors.delete(neighbor);

        const reverse = graph.getNeighbors(neighbor);
        reverse?.delete(node);
      }
    }

    if (neighbors.size === 0) {
      (graph as any).removeNode?.(node);
    }
  }
}
