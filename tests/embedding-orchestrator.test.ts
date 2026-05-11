import test from "node:test";
import assert from "node:assert/strict";

import type {
  EmbeddingProvider,
  EmbeddingResult,
  InterestCluster,
  InterestClusterDataset
} from "../src/index.js";
import {
  EmbeddingOrchestrator,
  clusterToEmbeddingText,
  signalToEmbeddingText
} from "../src/index.js";

const cluster: InterestCluster = {
  id: "gaming.console",
  status: "active",
  display: {
    label: "Console Gaming",
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
    primary_subcategories: ["PlayStation", "PlayStation"]
  },
  hashtags: {
    anchor: ["PS5"],
    aliases: ["PS5", "PlayStation5"],
    adjacent: [],
    excluded: []
  },
  keywords: {
    high_value: ["PS5"],
    secondary: ["Console Gaming"],
    negative: []
  },
  privacy: {
    respect_discoverable_false: true,
    respect_indexable_false: true,
    exclude_if_profile_or_posts_contain_opt_out_terms: true,
    opt_out_terms: ["#NoAI", "#NoIndex"]
  },
  sources: {
    curated_by: "test",
    seed_method: "manual",
    last_reviewed_at: "2026-01-01T00:00:00.000Z"
  }
};

const dataset: InterestClusterDataset = {
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

function embedding(text: string): EmbeddingResult {
  return {
    text,
    vector: {
      values: [1, 0, 0]
    }
  };
}

test("embedding orchestrator retries transient provider failures", async () => {
  let attempts = 0;

  const provider: EmbeddingProvider = {
    async embedOne(text) {
      return embedding(text);
    },
    async embedBatch(texts) {
      attempts += 1;

      if (attempts < 2) {
        throw new Error("temporary failure");
      }

      return texts.map((text) => embedding(text));
    }
  };

  const orchestrator = new EmbeddingOrchestrator(provider, {
    retryAttempts: 3,
    initialRetryDelayMs: 1,
    maxRetryDelayMs: 2
  });

  const documents = await orchestrator.generateClusterEmbeddings(dataset);

  assert.equal(documents.length, 1);
  assert.equal(attempts, 2);
});

test("embedding orchestrator rejects cardinality mismatches", async () => {
  const provider: EmbeddingProvider = {
    async embedOne(text) {
      return embedding(text);
    },
    async embedBatch() {
      return [];
    }
  };

  const orchestrator = new EmbeddingOrchestrator(provider);

  await assert.rejects(async () => {
    await orchestrator.generateClusterEmbeddings(dataset);
  });
});

test("embedding text normalization removes duplicate noisy values", () => {
  const text = clusterToEmbeddingText(cluster);

  assert.ok(text.includes("playstation"));
  assert.ok(!text.includes("PlayStation; PlayStation"));
});

test("signal embedding text normalizes control characters", () => {
  const text = signalToEmbeddingText({
    id: "1",
    kind: "post",
    nativeProtocol: "activitypub",
    authorId: "alice",
    text: "PS5\u0000\n\nlaunch",
    hashtags: ["PS5", "ps5"],
    keywords: [],
    entities: [],
    links: [],
    createdAt: new Date(0).toISOString(),
    visibility: "public"
  });

  assert.ok(!text.includes("\u0000"));
});
