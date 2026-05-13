import type { AnnProvider } from "../../ann/types.js";
import {
  createAnnSnapshot,
  type AnnSnapshot,
  type AnnVectorEntry
} from "../../ann/serialization.js";

export interface PgVectorSnapshotRecord {
  clusterId: string;
  values: number[];
}

export interface RestorePgVectorSnapshotOptions {
  batchSize?: number;
  onBatchRestored?: (restored: number, total: number) => void | Promise<void>;
}

export interface RestorePgVectorSnapshotResult {
  restored: number;
  total: number;
  dimensions: number;
}

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5_000;

function boundedBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(value ?? DEFAULT_BATCH_SIZE)));
}

function validateSnapshot(snapshot: AnnSnapshot): AnnSnapshot {
  const validated = createAnnSnapshot(snapshot.entries, snapshot.generatedAt);

  if (validated.dimensions !== snapshot.dimensions) {
    throw new Error("pgvector snapshot dimensions mismatch");
  }

  return validated;
}

export function snapshotToPgVectorRecords(snapshot: AnnSnapshot): PgVectorSnapshotRecord[] {
  const validated = validateSnapshot(snapshot);

  return validated.entries.map((entry) => ({
    clusterId: entry.clusterId,
    values: [...entry.vector.values]
  }));
}

export async function restorePgVectorSnapshot(
  provider: AnnProvider,
  snapshot: AnnSnapshot,
  options: RestorePgVectorSnapshotOptions = {}
): Promise<RestorePgVectorSnapshotResult> {
  const validated = validateSnapshot(snapshot);
  const batchSize = boundedBatchSize(options.batchSize);
  let restored = 0;

  for (let index = 0; index < validated.entries.length; index += batchSize) {
    const batch: AnnVectorEntry[] = validated.entries.slice(index, index + batchSize);

    for (const entry of batch) {
      await provider.upsert(entry.clusterId, entry.vector);
      restored += 1;
    }

    await options.onBatchRestored?.(restored, validated.entries.length);
  }

  return {
    restored,
    total: validated.entries.length,
    dimensions: validated.dimensions
  };
}
