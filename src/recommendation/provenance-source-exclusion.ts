import type { RecommendationCandidate } from "./candidate-domain.js";

/** True when any provenance entry of the candidate comes from one of the excluded source IDs. Internal, not part of the public API. */
export function hasExcludedProvenanceSource(candidate: Pick<RecommendationCandidate, "provenance">, excludeSourceIds: ReadonlySet<string>): boolean {
  return candidate.provenance.some((entry) => excludeSourceIds.has(entry.sourceId));
}
