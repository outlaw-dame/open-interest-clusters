import test from "node:test";
import assert from "node:assert/strict";

import {
  CooccurrenceGraph,
  enrichSignal,
  normalizeActivityPubSignal,
  normalizeATProtoSignal,
  normalizeCanonicalSignal,
  type EntityExtractor,
  type EntityLinker
} from "../src/index.js";

const extractor: EntityExtractor = {
  extract(text) {
    if (text.toLowerCase().includes("playstation")) {
      return [{ label: "PlayStation", normalized: "playstation" }];
    }

    return [];
  }
};

const linker: EntityLinker = {
  async link(entities) {
    return entities.map((entity) => ({
      ...entity,
      wikidataId: "Q10683",
      dbpediaResource: "PlayStation"
    }));
  }
};

test("enriches ActivityPub signals consistently", async () => {
  const graph = new CooccurrenceGraph();

  const signal = normalizeActivityPubSignal({
    id: "ap-1",
    type: "Create",
    actor: "https://example.com/users/alice",
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: {
      type: "Note",
      content: "PlayStation and PS5 are incredible",
      tag: [{ name: "#PS5" }, { name: "#PlayStation5" }]
    }
  });

  const enriched = await enrichSignal(signal, {
    extractor,
    linker,
    graph
  });

  assert.equal(enriched.signal.hashtags[0], "ps5");
  assert.ok(enriched.signal.keywords.includes("playstation"));
  assert.equal(enriched.signal.entities[0]?.wikidataId, "Q10683");
  assert.ok(graph.getNeighbors("ps5")?.has("playstation5"));
});

test("enriches ATProto signals consistently", async () => {
  const signal = normalizeATProtoSignal({
    uri: "at://did:plc:test/app.bsky.feed.post/1",
    did: "did:plc:test",
    record: {
      text: "PlayStation 5 performance test",
      tags: ["PS5Pro"]
    }
  });

  const enriched = await enrichSignal(signal, {
    extractor,
    linker
  });

  assert.ok(enriched.signal.keywords.includes("performance"));
  assert.equal(enriched.linkedEntities[0]?.wikidataId, "Q10683");
});

test("enriches Canonical signals consistently", async () => {
  const signal = normalizeCanonicalSignal({
    id: "canonical-1",
    nativeProtocol: "activitypub",
    authorId: "alice",
    text: "PS5 launch discussion",
    hashtags: ["#PS5"]
  });

  const enriched = await enrichSignal(signal, {
    includeTextKeywords: true
  });

  assert.equal(enriched.signal.hashtags[0], "ps5");
  assert.ok(enriched.signal.keywords.includes("launch"));
});
