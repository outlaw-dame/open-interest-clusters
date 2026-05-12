import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEmbeddingManifest,
  ClusterEmbeddingIndex,
  EmbeddingOrchestrator,
  InMemoryAnnProvider,
  runSemanticRefreshWorker,
  type EmbeddingProvider,
  type InterestClusterDataset
} from "../src/index.js";

class MockEmbeddingProvider implements EmbeddingProvider {
  async embedBatch(texts: readonly string[]) {
    return texts.map((text) => ({
      vector: {
        values: [text.length, 1]
      }
    }));
  }
}

function createDataset(): InterestClusterDataset {
  return {
    schemaVersion: "open-interest-clusters.v1",
    generatedAt: Date.now(),
    clusters: [
      {
        id: "gaming.playstation",
        title: "PlayStation",
        aliases: [],
        hashtags: ["PS5"],
        keywords: ["playstation"],
        parents: [],
        metadata: {
          category: "gaming"
        }
      }
    ]
  };
}

test("semantic refresh worker refreshes dirty clusters", async () => {
  const orchestrator = new EmbeddingOrchestrator(new MockEmbeddingProvider());
  const ann = new InMemoryAnnProvider();

  const result = await runSemanticRefreshWorker({
    dataset: createDataset(),
    manifest: null,
    orchestrator,
    annProvider: ann
  });

  assert.equal(result.refreshedClusterIds.length, 1);

  const stats = await ann.stats();
  assert.equal(stats.size, 1);
});

test("semantic refresh worker skips unchanged clusters", async () => {
  const orchestrator = new EmbeddingOrchestrator(new MockEmbeddingProvider());
  const dataset = createDataset();

  const manifest = buildEmbeddingManifest([
    {
      clusterId: "gaming.playstation",
      text: "PlayStation PS5 playstation",
      generatedAt: Date.now()
    }
  ]);

  const result = await runSemanticRefreshWorker({
    dataset,
    manifest,
    orchestrator
  });

  assert.equal(result.refreshedClusterIds.length, 0);
});

test("semantic refresh worker merges embeddings into existing index", async () => {
  const orchestrator = new EmbeddingOrchestrator(new MockEmbeddingProvider());

  const index = new ClusterEmbeddingIndex();
  index.upsert({
    clusterId: "legacy",
    vector: {
      values: [1, 1]
    }
  });

  const result = await runSemanticRefreshWorker({
    dataset: createDataset(),
    manifest: null,
    orchestrator,
    currentIndex: index
  });

  assert.ok(result.refreshedClusterIds.includes("gaming.playstation"));
});
