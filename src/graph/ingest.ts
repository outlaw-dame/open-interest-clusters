import { normalizeHashtag } from "../normalization/hashtags.js";
import { CooccurrenceGraph } from "./cooccurrence-graph.js";

const MAX_HASHTAGS_PER_POST = 64;
const MAX_HASHTAG_LENGTH = 128;

function sanitizeHashtags(hashtags: readonly string[]): string[] {
  return Array.from(
    new Set(
      hashtags
        .slice(0, MAX_HASHTAGS_PER_POST)
        .map((hashtag) => normalizeHashtag(hashtag))
        .filter((hashtag) => hashtag.length > 0)
        .filter((hashtag) => hashtag.length <= MAX_HASHTAG_LENGTH)
    )
  );
}

export function ingestPostIntoGraph(
  hashtags: readonly string[],
  graph: CooccurrenceGraph
): void {
  const normalized = sanitizeHashtags(hashtags);

  if (normalized.length < 2) {
    return;
  }

  graph.addCooccurrence(normalized);
}
