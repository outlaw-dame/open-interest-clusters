import type { EmbeddingVector } from "../embedding/types.js";
import type { AnnProvider } from "./types.js";

export interface AnnVectorEntry {
  clusterId: string;
  vector: EmbeddingVector;
}

export interface AnnSnapshot {
  schemaVersion: "ann-snapshot.v1";
  generatedAt: number;
  dimensions: number;
  entries: AnnVectorEntry[];
}

const MAX_CLUSTER_ID_LENGTH = 512;
const MAX_VECTOR_DIMENSIONS = 16_384;
const MAX_SNAPSHOT_ENTRIES = 100_000;

function validateClusterId(clusterId: string): void {
  if (!clusterId || clusterId.length > MAX_CLUSTER_ID_LENGTH || /[\u0000-\u001F\u007F]/u.test(clusterId)) {
    throw new Error("Invalid ANN snapshot cluster id");
  }
}

function validateVector(vector: EmbeddingVector, expectedDimensions?: number): number {
  const dimensions = vector.values.length;

  if (dimensions === 0 || dimensions > MAX_VECTOR_DIMENSIONS) {
    throw new Error("Invalid ANN snapshot vector dimensions");
  }

  if (expectedDimensions !== undefined && dimensions !== expectedDimensions) {
    throw new Error("ANN snapshot vector dimensions mismatch");
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("ANN snapshot vector contains non-finite values");
    }
  }

  return dimensions;
}

export function createAnnSnapshot(entries: readonly AnnVectorEntry[], now = Date.now()): AnnSnapshot {
  if (entries.length > MAX_SNAPSHOT_ENTRIES) {
    throw new Error("ANN snapshot exceeds maximum entry count");
  }

  const seen = new Set<string>();
  let dimensions = 0;

  const normalized = entries.map((entry) => {
    validateClusterId(entry.clusterId);

    const entryDimensions = validateVector(
      entry.vector,
      dimensions === 0 ? undefined : dimensions
    );

    if (dimensions === 0) {
      dimensions = entryDimensions;
    }

    if (seen.has(entry.clusterId)) {
      throw new Error(`Duplicate ANN snapshot cluster id: ${entry.clusterId}`);
    }

    seen.add(entry.clusterId);

    return {
      clusterId: entry.clusterId,
      vector: {
        values: [...entry.vector.values]
      }
    };
  });

  return {
    schemaVersion: "ann-snapshot.v1",
    generatedAt: Math.max(0, Math.floor(now)),
    dimensions,
    entries: normalized
  };
}

export function parseAnnSnapshot(serialized: string): AnnSnapshot {
  const parsed = JSON.parse(serialized) as AnnSnapshot;

  if (parsed.schemaVersion !== "ann-snapshot.v1") {
    throw new Error("Unsupported ANN snapshot schema");
  }

  if (!Array.isArray(parsed.entries) || parsed.entries.length > MAX_SNAPSHOT_ENTRIES) {
    throw new Error("Invalid ANN snapshot entries");
  }

  const snapshot = createAnnSnapshot(parsed.entries, parsed.generatedAt);

  if (snapshot.dimensions !== parsed.dimensions) {
    throw new Error("ANN snapshot declared dimensions do not match entries");
  }

  return snapshot;
}

export function serializeAnnSnapshot(snapshot: AnnSnapshot): string {
  return JSON.stringify(createAnnSnapshot(snapshot.entries, snapshot.generatedAt));
}

export async function restoreAnnSnapshot(
  provider: AnnProvider,
  snapshot: AnnSnapshot
): Promise<void> {
  const validated = createAnnSnapshot(snapshot.entries, snapshot.generatedAt);

  if (validated.dimensions !== snapshot.dimensions) {
    throw new Error("ANN snapshot dimensions mismatch");
  }

  for (const entry of validated.entries) {
    await provider.upsert(entry.clusterId, entry.vector);
  }
}
