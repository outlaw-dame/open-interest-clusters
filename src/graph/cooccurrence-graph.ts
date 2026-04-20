export type NodeId = string;

export interface Edge {
  weight: number;
  lastUpdated: number;
}

export class CooccurrenceGraph {
  private adjacency: Map<NodeId, Map<NodeId, Edge>> = new Map();

  constructor(
    private readonly maxEdgeWeight: number = 100,
    private readonly decayFactor: number = 0.95
  ) {}

  addCooccurrence(nodes: readonly string[]): void {
    const unique = Array.from(new Set(nodes));
    const now = Date.now();

    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        this.incrementEdge(unique[i], unique[j], now);
        this.incrementEdge(unique[j], unique[i], now);
      }
    }
  }

  private incrementEdge(a: NodeId, b: NodeId, now: number): void {
    let neighbors = this.adjacency.get(a);
    if (!neighbors) {
      neighbors = new Map();
      this.adjacency.set(a, neighbors);
    }

    const existing = neighbors.get(b);

    if (existing) {
      existing.weight *= this.decayFactor;
      existing.weight = Math.min(this.maxEdgeWeight, existing.weight + 1);
      existing.lastUpdated = now;
    } else {
      neighbors.set(b, { weight: 1, lastUpdated: now });
    }
  }

  getNeighbors(node: NodeId): Map<NodeId, Edge> | undefined {
    return this.adjacency.get(node);
  }

  getNodes(): Iterable<NodeId> {
    return this.adjacency.keys();
  }

  getGraph(): ReadonlyMap<NodeId, Map<NodeId, Edge>> {
    return this.adjacency;
  }
}
