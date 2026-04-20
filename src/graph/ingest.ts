import { normalizeHashtag } from "../normalization/hashtags.js";
import { CooccurrenceGraph } from "./cooccurrence-graph.js";

export function ingestPostIntoGraph(
  hashtags: readonly string[],
  graph: CooccurrenceGraph
): void {
  const normalized = hashtags
    .map((h) => normalizeHashtag(h))
    .filter((h) => h.length > 0);

  if (normalized.length < 2) return;

  graph.addCooccurrence(normalized);
}
