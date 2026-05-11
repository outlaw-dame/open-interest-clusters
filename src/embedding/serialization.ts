import fs from "node:fs/promises";
import path from "node:path";

import { ClusterEmbeddingIndex } from "./cluster-embedding-index.js";
import type { ClusterEmbedding, EmbeddingVector } from "./types.js";

export interface EmbeddingIndexSnapshot {
  schemaVersion: "embedding-index.v1";
  generatedAt: string;
  embeddings: ClusterEmbedding[];
}

export interface SaveEmbeddingIndexOptions {
  rotate?: boolean;
  maxSnapshots?: number;
}

const MAX_EMBEDDINGS_PER_SNAPSHOT = 100_000;
const MAX_VECTOR_DIMENSIONS = 16_384;

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `${path.basename(filePath)}.${process.pid}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, data, "utf-8");
  await fs.rename(tempPath, filePath);
}

function validateClusterId(clusterId: string): void {
  if (!clusterId || clusterId.length > 512 || /[\u0000-\u001F\u007F]/u.test(clusterId)) {
    throw new Error("Invalid cluster embedding id");
  }
}

function validateVector(vector: EmbeddingVector): void {
  if (vector.values.length === 0 || vector.values.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error("Invalid embedding vector dimensions");
  }

  for (const value of vector.values) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains non-finite values");
    }
  }
}

export function snapshotEmbeddingIndex(index: ClusterEmbeddingIndex): EmbeddingIndexSnapshot {
  const embeddings = index.toEmbeddings();

  if (embeddings.length > MAX_EMBEDDINGS_PER_SNAPSHOT) {
    throw new Error("Embedding index snapshot exceeds maximum embedding count");
  }

  const seen = new Set<string>();

  for (const embedding of embeddings) {
    validateClusterId(embedding.clusterId);
    validateVector(embedding.vector);

    if (seen.has(embedding.clusterId)) {
      throw new Error(`Duplicate embedding cluster id: ${embedding.clusterId}`);
    }

    seen.add(embedding.clusterId);
  }

  return {
    schemaVersion: "embedding-index.v1",
    generatedAt: new Date().toISOString(),
    embeddings
  };
}

export function mergeEmbeddingSnapshots(
  base: ClusterEmbeddingIndex,
  updates: readonly ClusterEmbedding[],
  activeClusterIds?: readonly string[]
): ClusterEmbeddingIndex {
  const merged = new ClusterEmbeddingIndex(base.toEmbeddings());

  for (const embedding of updates) {
    validateClusterId(embedding.clusterId);
    validateVector(embedding.vector);
    merged.set(embedding.clusterId, embedding.vector);
  }

  if (activeClusterIds) {
    const active = new Set(activeClusterIds);

    for (const embedding of merged.toEmbeddings()) {
      if (!active.has(embedding.clusterId)) {
        merged.delete(embedding.clusterId);
      }
    }
  }

  return merged;
}

export function restoreEmbeddingIndex(snapshot: EmbeddingIndexSnapshot): ClusterEmbeddingIndex {
  if (snapshot.schemaVersion !== "embedding-index.v1") {
    throw new Error("Unsupported embedding index snapshot schema");
  }

  if (!Array.isArray(snapshot.embeddings) || snapshot.embeddings.length > MAX_EMBEDDINGS_PER_SNAPSHOT) {
    throw new Error("Invalid embedding index snapshot size");
  }

  const index = new ClusterEmbeddingIndex();

  for (const embedding of snapshot.embeddings) {
    validateClusterId(embedding.clusterId);
    validateVector(embedding.vector);
    index.set(embedding.clusterId, embedding.vector);
  }

  return index;
}

export async function saveEmbeddingIndexSnapshot(
  index: ClusterEmbeddingIndex,
  filePath: string,
  options: SaveEmbeddingIndexOptions = {}
): Promise<void> {
  const snapshot = snapshotEmbeddingIndex(index);
  const serialized = JSON.stringify(snapshot);

  await atomicWrite(filePath, serialized);

  if (!options.rotate) {
    return;
  }

  const directory = path.dirname(filePath);
  const base = path.basename(filePath);
  const rotatedPath = path.join(directory, `${base}.${snapshot.generatedAt}.snap`);

  await fs.copyFile(filePath, rotatedPath);

  if (options.maxSnapshots) {
    const files = (await fs.readdir(directory))
      .filter((entry) => entry.startsWith(base) && entry.endsWith(".snap"))
      .sort();

    const excess = files.length - options.maxSnapshots;
    for (let index = 0; index < excess; index += 1) {
      const candidate = files[index];
      if (!candidate) continue;
      await fs.unlink(path.join(directory, candidate));
    }
  }
}

export async function loadEmbeddingIndexSnapshot(filePath: string): Promise<ClusterEmbeddingIndex> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as EmbeddingIndexSnapshot;
  return restoreEmbeddingIndex(parsed);
}

export async function loadLatestValidEmbeddingSnapshot(
  directory: string,
  baseFile: string
): Promise<ClusterEmbeddingIndex | null> {
  const files = (await fs.readdir(directory))
    .filter((entry) => entry.startsWith(baseFile))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      return await loadEmbeddingIndexSnapshot(path.join(directory, file));
    } catch {
      continue;
    }
  }

  return null;
}
