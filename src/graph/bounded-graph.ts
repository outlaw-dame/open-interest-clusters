import { CooccurrenceGraph } from "./cooccurrence-graph.js";

export class BoundedGraph extends CooccurrenceGraph {
  private readonly maxNodes: number;

  constructor(maxNodes = 10000) {
    super();
    this.maxNodes = maxNodes;
  }

  enforceBounds(): void {
    const nodes = Array.from(this.getNodes());

    if (nodes.length <= this.maxNodes) return;

    const excess = nodes.length - this.maxNodes;

    for (let index = 0; index < excess; index += 1) {
      const node = nodes[index];
      if (!node) continue;
      this.removeNode(node);
    }
  }
}
