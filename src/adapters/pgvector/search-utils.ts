import type { AnnSearchResult } from "../../ann/types.js";
import type { PgVectorDistanceMetric } from "./types.js";

export interface PgVectorSearchRow extends Record<string, unknown> {
  cluster_id: unknown;
  similarity: unknown;
}

export function pgVectorSimilarityExpression(
  metric: PgVectorDistanceMetric,
  vectorColumn: string
): string {
  const column = `"${vectorColumn}"`;

  switch (metric) {
    case "cosine":
      return `1 - (${column} <=> $1::vector)`;
    case "inner_product":
      return `-1 * (${column} <#> $1::vector)`;
    case "l2":
      return `-1 * (${column} <-> $1::vector)`;
  }
}

export function parsePgVectorSearchRows(
  rows: readonly PgVectorSearchRow[],
  minSimilarity: number
): AnnSearchResult[] {
  const parsed: AnnSearchResult[] = [];

  for (const row of rows) {
    const clusterId = typeof row.cluster_id === "string" ? row.cluster_id : "";
    const similarity = typeof row.similarity === "number" ? row.similarity : Number(row.similarity);

    if (!clusterId || !Number.isFinite(similarity) || similarity < minSimilarity) {
      continue;
    }

    parsed.push({
      clusterId,
      similarity
    });
  }

  return parsed;
}
