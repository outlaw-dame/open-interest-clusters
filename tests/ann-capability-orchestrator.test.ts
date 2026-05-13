import test from "node:test";
import assert from "node:assert/strict";

import {
  createCapabilityAwareAnnOrchestrator,
  type AnnProvider,
  type CapableAnnProviderCandidate
} from "../src/index.js";

function provider(name: string, failSearch = false): AnnProvider {
  return {
    async upsert() {},
    async delete() {
      return true;
    },
    async search() {
      if (failSearch) {
        throw new Error(`${name} failed`);
      }
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
      name: "pgvector-primary",
      provider: provider("pgvector-primary", true),
      priority: 10,
      capabilities: { persistence: "durable", metadataFiltering: true }
    },
    {
      name: "pgvector-fallback",
      provider: provider("pgvector-fallback"),
      priority: 5,
      capabilities: { persistence: "durable", metadataFiltering: true }
    }
  ];
}

test("capability-aware resilient orchestrator falls back within capability set", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });

  assert.equal(result.provider, "pgvector-fallback");
  assert.deepEqual(result.result, [{ clusterId: "pgvector-fallback", similarity: 1 }]);
});

test("capability-aware resilient orchestrator preserves metrics visibility", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true }
  });

  await orchestrator.search({ values: [1, 2, 3] });
  const metrics = orchestrator.getOrchestrator().getRetryMetrics();

  assert.equal(metrics.fallbackActivations, 1);
});

test("capability-aware resilient orchestrator rejects impossible requirements", () => {
  assert.throws(() =>
    createCapabilityAwareAnnOrchestrator(candidates(), {
      requirement: { hybridSparseDense: true }
    })
  );
});
