import { createHash } from "node:crypto";

import type { InterestCluster, InterestClusterDataset } from "../types/schema.js";
import { clusterToEmbeddingText, type EmbeddingTextOptions } from "./text.js";

export interface ClusterEmbeddingManifestEntry {
  clusterId: string;
  textHash: string;
  generatedAt: number;
}

export interface ClusterEmbeddingManifest {
  schemaVersion: "embedding-refresh-manifest.v1";
  generatedAt: number;
  entries: ClusterEmbeddingManifestEntry[];
}

export interface DirtyClusterResult {
  cluster: InterestCluster;
  reason: "missing" | "changed";
  text: string;
  textHash: string;
}

export interface DirtyClusterOptions {
  text?: EmbeddingTextOptions;
  maxDirtyClusters?: number;
}

const MAX_DIRTY_CLUSTERS = 10_000;

export function hashEmbeddingText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildEmbeddingManifest(
  documents: readonly { clusterId: string; text: string; generatedAt: number }[]
): ClusterEmbeddingManifest {
  return {
    schemaVersion: "embedding-refresh-manifest.v1",
    generatedAt: Date.now(),
    entries: documents.map((document) => ({
      clusterId: document.clusterId,
      textHash: hashEmbeddingText(document.text),
      generatedAt: document.generatedAt
    }))
  };
}

export function findDirtyClusters(
  dataset: InterestClusterDataset,
  manifest: ClusterEmbeddingManifest | null,
  options: DirtyClusterOptions = {}
): DirtyClusterResult[] {
  const maxDirtyClusters = Math.max(1, Math.min(options.maxDirtyClusters ?? MAX_DIRTY_CLUSTERS, MAX_DIRTY_CLUSTERS));
  const previous = new Map<string, ClusterEmbeddingManifestEntry>();

  if (manifest) {
    if (manifest.schemaVersion !== "embedding-refresh-manifest.v1") {
      throw new Error("Unsupported embedding refresh manifest schema");
    }

    for (const entry of manifest.entries) {
      previous.set(entry.clusterId, entry);
    }
  }

  const dirty: DirtyClusterResult[] = [];

  for (const cluster of dataset.clusters) {
    const text = clusterToEmbeddingText(cluster, options.text);
    const textHash = hashEmbeddingText(text);
    const existing = previous.get(cluster.id);

    if (!existing) {
      dirty.push({ cluster, reason: "missing", text, textHash });
    } else if (existing.textHash !== textHash) {
      dirty.push({ cluster, reason: "changed", text, textHash });
    }

    if (dirty.length >= maxDirtyClusters) {
      break;
    }
  }

  return dirty;
}
