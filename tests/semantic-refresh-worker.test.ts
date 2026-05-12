import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEmbeddingManifest,
  ClusterEmbeddingIndex,
  EmbeddingOrchestrator,
  InMemoryAnnProvider,
  runSemanticRefreshWorker,
  clusterToEmbeddingText,
  type EmbeddingProvider,
  type EmbeddingResult,
  type InterestCluster,
  type InterestClusterDataset
} from "../src/index.js";

const cluster: InterestCluster = {
  id: "gaming.playstation",
  status: "active",
  display: {
    label: "PlayStation",
    category: "gaming"
  },
  anchor: {
    hashtag: "#PS5",
    follow_by_default_if_interest_selected: true
  },
  follow_behavior: {
    mode: "anchor_plus_related",
    allow_user_opt_in_related_hashtags: true,
    max_auto_follow_hashtags: 8
  },
  taxonomy: {
    primary_subcategories: ["PlayStation"]
  },
  hashtags: {
    anchor: ["PS5"],
    aliases: ["PlayStation5"],
    adjacent: [],
    excluded: []
  },
  keywords: {
    high_value: ["PlayStation"],
    secondary: ["PS5"],
    negative: []
  },
  privacy: {
    respect_discoverable_false: true,
    respect_indexable_false: true,
    exclude_if_profile_or_posts_contain_opt_out_terms: true,
    opt_out_terms: []
  },
  sources: {
    curated_by: "test",
    seed_method: "manual",
    last_reviewed_at: "2026-01-01T00:00:00.000Z"
  }
};

function createDataset(): InterestClusterDataset {
  return {
    schema_version: "1.0.0",
    dataset_id: "test-dataset",
    dataset_version: "1.0.0",
    locale_default: "en-US",
    normalization: {
      unicode_form: "NFKC",
      casefold: true,
      strip_leading_hash_for_storage: true
    },
    clusters: [cluster]
  };
}

function embedding(text: string): EmbeddingResult {
  return {
    text,
    vector: {
      values: [text.length, 1]
    }
  };
}

class MockEmbeddingProvider implements EmbeddingProvider {
  async embedOne(text: string): Promise<EmbeddingResult> {
    return embedding(text);
  }

  async embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    return texts.map((text) => embedding(text));
  }
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
      clusterId: cluster.id,
      text: clusterToEmbeddingText(cluster),
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
  index.set("legacy", {
    values: [1, 1]
  });

  const result = await runSemanticRefreshWorker({
    dataset: createDataset(),
    manifest: null,
    orchestrator,
    currentIndex: index
  });

  assert.ok(result.refreshedClusterIds.includes("gaming.playstation"));
});
