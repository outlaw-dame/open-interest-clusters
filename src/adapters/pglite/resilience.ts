import type { AnnIndexStats, AnnProvider } from "../../ann/types.js";
import type { AnnSnapshot } from "../../ann/serialization.js";
import {
  restorePgVectorSnapshot,
  type RestorePgVectorSnapshotOptions,
  type RestorePgVectorSnapshotResult
} from "../pgvector/snapshot.js";

export interface PGliteHealthCheckResult {
  ok: boolean;
  stats?: AnnIndexStats;
  error?: string;
}

export interface RebuildPGliteFromSnapshotOptions {
  expectedDimensions?: number;
  minimumEntries?: number;
  batchSize?: number;
  onBatchRestored?: (restored: number, total: number) => void | Promise<void>;
}

export interface RebuildPGliteFromSnapshotResult extends RestorePgVectorSnapshotResult {
  rebuilt: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown PGlite health check error";
}

function restoreOptions(options: RebuildPGliteFromSnapshotOptions): RestorePgVectorSnapshotOptions {
  const result: RestorePgVectorSnapshotOptions = {};

  if (options.batchSize !== undefined) {
    result.batchSize = options.batchSize;
  }

  if (options.onBatchRestored !== undefined) {
    result.onBatchRestored = options.onBatchRestored;
  }

  return result;
}

export async function checkPGliteAnnHealth(provider: AnnProvider): Promise<PGliteHealthCheckResult> {
  try {
    const stats = await provider.stats();

    return {
      ok: true,
      stats
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error)
    };
  }
}

export async function rebuildPGliteFromSnapshot(
  provider: AnnProvider,
  snapshot: AnnSnapshot,
  options: RebuildPGliteFromSnapshotOptions = {}
): Promise<RebuildPGliteFromSnapshotResult> {
  if (options.expectedDimensions !== undefined && snapshot.dimensions !== options.expectedDimensions) {
    throw new Error("PGlite snapshot dimensions do not match expected dimensions");
  }

  if (options.minimumEntries !== undefined && snapshot.entries.length < options.minimumEntries) {
    throw new Error("PGlite snapshot does not contain the minimum required entries");
  }

  const result = await restorePgVectorSnapshot(provider, snapshot, restoreOptions(options));

  return {
    ...result,
    rebuilt: true
  };
}
