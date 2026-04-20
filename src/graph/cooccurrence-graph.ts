export type NodeId = string;

export interface Edge {
  weight: number;
  lastUpdated: number;
}

export interface GraphNodeSnapshot {
  node: NodeId;
  neighbors: Array<{ node: NodeId; edge: Edge }>;
}

export interface GraphSnapshot {
  version: 1;
  generatedAt: number;
  maxEdgeWeight: number;
  decayFactor: number;
  maxEdgesPerNode: number;
  nodes: GraphNodeSnapshot[];
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  maxDegree: number;
  isolatedNodeCount: number;
  lastUpdatedMin?: number;
  lastUpdatedMax?: number;
}

export class CooccurrenceGraph {
  protected readonly adjacency: Map<NodeId, Map<NodeId, Edge>> = new Map();

  constructor(
    protected readonly maxEdgeWeight: number = 100,
    protected readonly decayFactor: number = 0.95,
    protected readonly maxEdgesPerNode: number = 256
  ) {}

  addCooccurrence(nodes: readonly string[]): void {
    const unique = Array.from(new Set(nodes));
    if (unique.length < 2) return;

    const now = Date.now();

    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const left = unique[i];
        const right = unique[j];
        if (!left || !right) continue;
        this.incrementEdge(left, right, now);
        this.incrementEdge(right, left, now);
      }
    }
  }

  protected incrementEdge(a: NodeId, b: NodeId, now: number): void {
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

    this.trimEdgesForNode(a);
  }

  protected trimEdgesForNode(node: NodeId): void {
    const neighbors = this.adjacency.get(node);
    if (!neighbors || neighbors.size <= this.maxEdgesPerNode) return;

    const sorted = Array.from(neighbors.entries()).sort((left, right) => {
      if (left[1].weight !== right[1].weight) return left[1].weight - right[1].weight;
      return left[1].lastUpdated - right[1].lastUpdated;
    });

    const overflow = neighbors.size - this.maxEdgesPerNode;
    for (let index = 0; index < overflow; index += 1) {
      const candidate = sorted[index];
      if (!candidate) continue;
      neighbors.delete(candidate[0]);
      const reverseNeighbors = this.adjacency.get(candidate[0]);
      reverseNeighbors?.delete(node);
      if (reverseNeighbors && reverseNeighbors.size === 0) this.adjacency.delete(candidate[0]);
    }

    if (neighbors.size === 0) this.adjacency.delete(node);
  }

  protected removeNode(node: NodeId): void {
    const neighbors = this.adjacency.get(node);
    if (!neighbors) return;

    for (const neighbor of neighbors.keys()) {
      const reverseNeighbors = this.adjacency.get(neighbor);
      reverseNeighbors?.delete(node);
      if (reverseNeighbors && reverseNeighbors.size === 0) this.adjacency.delete(neighbor);
    }

    this.adjacency.delete(node);
  }

  protected upsertEdge(node: NodeId, neighbor: NodeId, edge: Edge): void {
    let neighbors = this.adjacency.get(node);
    if (!neighbors) {
      neighbors = new Map();
      this.adjacency.set(node, neighbors);
    }
    neighbors.set(neighbor, { ...edge });
    this.trimEdgesForNode(node);
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

  getMetrics(): GraphMetrics {
    let edgeCount = 0;
    let maxDegree = 0;
    let isolatedNodeCount = 0;
    let lastUpdatedMin: number | undefined;
    let lastUpdatedMax: number | undefined;

    for (const neighbors of this.adjacency.values()) {
      const degree = neighbors.size;
      edgeCount += degree;
      if (degree > maxDegree) maxDegree = degree;
      if (degree === 0) isolatedNodeCount += 1;

      for (const edge of neighbors.values()) {
        if (lastUpdatedMin === undefined || edge.lastUpdated < lastUpdatedMin) lastUpdatedMin = edge.lastUpdated;
        if (lastUpdatedMax === undefined || edge.lastUpdated > lastUpdatedMax) lastUpdatedMax = edge.lastUpdated;
      }
    }

    const metrics: GraphMetrics = {
      nodeCount: this.adjacency.size,
      edgeCount,
      maxDegree,
      isolatedNodeCount
    };

    if (lastUpdatedMin !== undefined) metrics.lastUpdatedMin = lastUpdatedMin;
    if (lastUpdatedMax !== undefined) metrics.lastUpdatedMax = lastUpdatedMax;

    return metrics;
  }

  toSnapshot(): GraphSnapshot {
    const nodes = Array.from(this.adjacency.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([node, neighbors]) => ({
        node,
        neighbors: Array.from(neighbors.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([neighbor, edge]) => ({ node: neighbor, edge: { ...edge } }))
      }));

    return {
      version: 1,
      generatedAt: Date.now(),
      maxEdgeWeight: this.maxEdgeWeight,
      decayFactor: this.decayFactor,
      maxEdgesPerNode: this.maxEdgesPerNode,
      nodes
    };
  }

  static fromSnapshot(snapshot: GraphSnapshot): CooccurrenceGraph {
    if (snapshot.version !== 1) throw new Error(`Unsupported graph snapshot version: ${snapshot.version}`);

    const graph = new CooccurrenceGraph(snapshot.maxEdgeWeight, snapshot.decayFactor, snapshot.maxEdgesPerNode);
    for (const nodeSnapshot of snapshot.nodes) {
      for (const neighbor of nodeSnapshot.neighbors) {
        graph.upsertEdge(nodeSnapshot.node, neighbor.node, neighbor.edge);
      }
    }
    return graph;
  }
}
