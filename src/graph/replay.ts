import type { CooccurrenceGraph } from "./cooccurrence-graph.js";

export function replayEvents(
  events: readonly string[][],
  graph: CooccurrenceGraph
): void {
  for (const hashtags of events) {
    graph.addCooccurrence(hashtags);
  }
}
