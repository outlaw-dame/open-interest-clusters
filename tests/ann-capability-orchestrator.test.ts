import test from "node:test";
import assert from "node:assert/strict";

import {
  createCapabilityAwareAnnOrchestrator,
  type AnnProvider,
  type CapableAnnProviderCandidate
} from "../src/index.js";

function provider(
  name: string,
  options: {
    failSearch?: boolean;
    failUpsert?: boolean;
    failDelete?: boolean;
    deleteResult?: boolean;
  } = {}
): AnnProvider {
  return {
    async upsert() {
      if (options.failUpsert) {
        throw new Error(`${name} upsert failed`);
      }
    },
    async delete() {
      if (options.failDelete) {
        throw new Error(`${name} delete failed`);
      }
      return options.deleteResult ?? true;
    },
    async search() {
      if (options.failSearch) {
        throw new Error(`${name} search failed`);
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
      provider: provider("pgvector-primary", { failSearch: true, failUpsert: true }),
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

test("capability-aware resilient orchestrator attributes write fallback correctly", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true }
  });

  const result = await orchestrator.upsert("cluster-a", { values: [1, 2, 3] });

  assert.equal(result.provider, "pgvector-fallback");
  assert.equal(result.result, undefined);
});

test("capability-aware resilient orchestrator respects fail-closed semantics", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true },
    failOpen: false
  });

  await assert.rejects(() => orchestrator.upsert("cluster-a", { values: [1, 2, 3] }));
});

test("capability-aware resilient orchestrator rejects impossible requirements", () => {
  assert.throws(() =>
    createCapabilityAwareAnnOrchestrator(candidates(), {
      requirement: { hybridSparseDense: true }
    })
  );
});
