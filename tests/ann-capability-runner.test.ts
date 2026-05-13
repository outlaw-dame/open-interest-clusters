import test from "node:test";
import assert from "node:assert/strict";

import {
  searchWithAnnCapabilities,
  selectCapabilityAwareAnnProvider,
  statsWithAnnCapabilities,
  type AnnProvider,
  type CapableAnnProviderCandidate
} from "../src/index.js";

function provider(name: string): AnnProvider {
  return {
    async upsert() {},
    async delete() {
      return true;
    },
    async search() {
      return [{ clusterId: name, similarity: 1 }];
    },
    async stats() {
      return { size: 10, dimensions: 3 };
    }
  };
}

function candidates(): CapableAnnProviderCandidate[] {
  return [
    {
      name: "memory",
      provider: provider("memory"),
      priority: 1,
      capabilities: { persistence: "none" }
    },
    {
      name: "pglite",
      provider: provider("pglite"),
      priority: 5,
      capabilities: { persistence: "local", snapshots: true }
    },
    {
      name: "pgvector",
      provider: provider("pgvector"),
      priority: 10,
      capabilities: { persistence: "durable", snapshots: true, metadataFiltering: true }
    }
  ];
}

test("capability-aware provider selection chooses highest matching provider", () => {
  const selection = selectCapabilityAwareAnnProvider(candidates(), {
    persistence: "local",
    snapshots: true
  });

  assert.equal(selection.provider, "pgvector");
  assert.equal(selection.capabilities.persistence, "durable");
});

test("capability-aware ANN search executes against selected provider", async () => {
  const execution = await searchWithAnnCapabilities(
    candidates(),
    { metadataFiltering: true },
    { values: [1, 2, 3] }
  );

  assert.equal(execution.provider, "pgvector");
  assert.deepEqual(execution.result, [{ clusterId: "pgvector", similarity: 1 }]);
});

test("capability-aware ANN stats executes against selected provider", async () => {
  const execution = await statsWithAnnCapabilities(candidates(), {
    persistence: "local"
  });

  assert.equal(execution.provider, "pgvector");
  assert.deepEqual(execution.result, { size: 10, dimensions: 3 });
});

test("capability-aware execution fails deterministically when no provider matches", async () => {
  await assert.rejects(() =>
    searchWithAnnCapabilities(candidates(), { hybridSparseDense: true }, { values: [1, 2, 3] })
  );
});
