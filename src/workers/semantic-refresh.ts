import type { AnnProvider } from "../ann/types.js";
import type { ClusterEmbeddingDocument, EmbeddingOrchestrator } from "../embedding/orchestrator.js";
import {
  buildEmbeddingManifest,
  findDirtyClusters,
  type ClusterEmbeddingManifest
} from "../embedding/refresh.js";
import { ClusterEmbeddingIndex } from "../embedding/cluster-embedding-index.js";
import { mergeEmbeddingSnapshots } from "../embedding/serialization.js";
import type { InterestClusterDataset } from "../types/schema.js";

export interface SemanticRefreshWorkerOptions {
  maxDirtyClusters?: number;
  maxRefreshClusters?: number;
  updateAnn?: boolean;
}

export interface SemanticRefreshResult {
  refreshedClusterIds: string[];
  skipped: number;
  manifest: ClusterEmbeddingManifest;
  documents: ClusterEmbeddingDocument[];
}

const DEFAULT_MAX_DIRTY_CLUSTERS = 10_000;
const DEFAULT_MAX_REFRESH_CLUSTERS = 1_000;

function boundedPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

export async function runSemanticRefreshWorker(input: {
  dataset: InterestClusterDataset;
  manifest: ClusterEmbeddingManifest | null;
  orchestrator: EmbeddingOrchestrator;
  currentIndex?: ClusterEmbeddingIndex;
  annProvider?: AnnProvider;
  options?: SemanticRefreshWorkerOptions;
}): Promise<SemanticRefreshResult> {
  const maxDirtyClusters = boundedPositiveInteger(
    input.options?.maxDirtyClusters,
    DEFAULT_MAX_DIRTY_CLUSTERS,
    1,
    DEFAULT_MAX_DIRTY_CLUSTERS
  );
  const maxRefreshClusters = boundedPositiveInteger(
    input.options?.maxRefreshClusters,
    DEFAULT_MAX_REFRESH_CLUSTERS,
    1,
    DEFAULT_MAX_REFRESH_CLUSTERS
  );

  const dirty = findDirtyClusters(input.dataset, input.manifest, {
    maxDirtyClusters
  });
  const selected = dirty.slice(0, maxRefreshClusters);

  if (selected.length === 0) {
    return {
      refreshedClusterIds: [],
      skipped: 0,
      manifest: input.manifest ?? buildEmbeddingManifest([]),
      documents: []
    };
  }

  const documents = await input.orchestrator.generateClusterEmbeddingsForClusters(
    selected.map((entry) => entry.cluster)
  );

  const updates = documents.map((document) => ({
    clusterId: document.clusterId,
    vector: document.embedding.vector
  }));

  const baseIndex = input.currentIndex ?? new ClusterEmbeddingIndex();
  const activeClusterIds = input.dataset.clusters.map((cluster) => cluster.id);
  const merged = mergeEmbeddingSnapshots(baseIndex, updates, activeClusterIds);

  if (input.options?.updateAnn !== false && input.annProvider) {
    for (const update of updates) {
      await input.annProvider.upsert(update.clusterId, update.vector);
    }

    for (const existing of baseIndex.toEmbeddings()) {
      if (!activeClusterIds.includes(existing.clusterId)) {
        await input.annProvider.delete(existing.clusterId);
      }
    }
  }

  return {
    refreshedClusterIds: documents.map((document) => document.clusterId),
    skipped: Math.max(0, dirty.length - selected.length),
    manifest: buildEmbeddingManifest(merged.toEmbeddings().map((embedding) => ({
      clusterId: embedding.clusterId,
      text: documents.find((document) => document.clusterId === embedding.clusterId)?.text ?? embedding.clusterId,
      generatedAt: Date.now()
    }))),
    documents
  };
}
