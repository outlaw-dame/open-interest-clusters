import test from "node:test";
import assert from "node:assert/strict";

import {
  ClusterEmbeddingIndex,
  SemanticRetrievalService,
  type EmbeddingProvider,
  type EmbeddingResult,
  type UnifiedSignal
} from "../src/index.js";

class TestEmbeddingProvider implements EmbeddingProvider {
  public async embedOne(text: string): Promise<EmbeddingResult> {
    return {
      text,
      vector: {
        values: text.toLowerCase().includes("playstation")
          ? [1, 0]
          : [0, 1]
      }
    };
  }

  public async embedBatch(texts: readonly string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }
}

function createSignal(text: string): UnifiedSignal {
  return {
    id: "signal-1",
    canonicalUrl: "https://example.com/post/1",
    kind: "post",
    nativeProtocol: "activitypub",
    upstreamOrigin: "activitypub",
    authorId: "https://example.com/users/test",
    authorHandle: "@test@example.com",
    text,
    language: "en",
    hashtags: [],
    keywords: [],
    entities: [],
    links: [],
    createdAt: new Date(0).toISOString(),
    visibility: "public",
    discoverableAuthor: true,
    indexable: true
  };
}

test("semantic retrieval returns ranked embedding matches", async () => {
  const provider = new TestEmbeddingProvider();
  const index = new ClusterEmbeddingIndex();

  index.set("gaming", {
    values: [1, 0]
  });

  index.set("books", {
    values: [0, 1]
  });

  const retrieval = new SemanticRetrievalService(provider, index);

  const result = await retrieval.retrieveForSignal(
    createSignal("PlayStation and PS5 news"),
    {
      limit: 2,
      minSimilarity: 0
    }
  );

  assert.equal(result.matches[0]?.clusterId, "gaming");
  assert.ok((result.matches[0]?.similarity ?? 0) > (result.matches[1]?.similarity ?? 0));
  assert.equal(result.scores[0]?.clusterId, "gaming");
});
