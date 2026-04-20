import { CooccurrenceGraph } from "./cooccurrence-graph.js";

export class BoundedGraph extends CooccurrenceGraph {
  private maxNodes: number;

  constructor(maxNodes = 10000) {
    super();
    this.maxNodes = maxNodes;
  }

  enforceBounds(): void {
    const nodes = Array.from(this.getNodes());

    if (nodes.length <= this.maxNodes) return;

    const excess = nodes.length - this.maxNodes;

    for (let i = 0; i < excess; i++) {
      const node = nodes[i];
      (this as any).adjacency.delete(node);
    }
  }
}
