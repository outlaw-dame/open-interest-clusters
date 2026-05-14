import test from "node:test";
import assert from "node:assert/strict";

import {
  createCapabilityAwareAnnOrchestrator,
  type AnnProvider,
  type CapableAnnProviderCandidate
} from "../src/index.js";

interface ProviderCounters {
  upserts: number;
  deletes: number;
}

function provider(
  name: string,
  options: {
    failSearch?: boolean;
    failUpsert?: boolean;
    failDelete?: boolean;
    deleteResult?: boolean;
    counters?: ProviderCounters;
  } = {}
): AnnProvider {
  return {
    async upsert() {
      if (options.counters !== undefined) {
        options.counters.upserts += 1;
      }

      if (options.failUpsert) {
        throw new Error(`${name} upsert failed`);
      }
    },
    async delete() {
      if (options.counters !== undefined) {
        options.counters.deletes += 1;
      }

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
      name: "pglite",
      provider: provider("pglite"),
      priority: 6,
      capabilities: { persistence: "local", metadataFiltering: true }
    },
    {
      name: "pgvector-primary",
      provider: provider("pgvector-primary", { failSearch: true, failUpsert: true, failDelete: true }),
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

test("capability-aware resilient orchestrator falls back within durable capability set", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { persistence: "durable", metadataFiltering: true }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });

  assert.equal(result.provider, "pgvector-fallback");
  assert.deepEqual(result.result, [{ clusterId: "pgvector-fallback", similarity: 1 }]);
});

test("deployment-aware capability orchestration prefers browser-local providers", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true },
    deployment: {
      environment: "browser"
    }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });

  assert.equal(result.provider, "pglite");
});

test("deployment-aware capability orchestration prefers durable server providers", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { metadataFiltering: true },
    deployment: {
      environment: "server",
      requireDurableWrites: true
    }
  });

  const result = await orchestrator.stats();

  assert.equal(result.provider, "pgvector-primary");
});

test("capability-aware resilient orchestrator preserves durable fallback metrics visibility", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { persistence: "durable", metadataFiltering: true }
  });

  await orchestrator.search({ values: [1, 2, 3] });
  const metrics = orchestrator.getOrchestrator().getRetryMetrics();

  assert.equal(metrics.fallbackActivations, 1);
});

test("capability-aware resilient orchestrator attributes durable write fallback correctly", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { persistence: "durable", metadataFiltering: true }
  });

  const result = await orchestrator.upsert("cluster-a", { values: [1, 2, 3] });

  assert.equal(result.provider, "pgvector-fallback");
  assert.equal(result.result, undefined);
});

test("capability-aware resilient orchestrator attributes durable delete fallback correctly", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { persistence: "durable", metadataFiltering: true }
  });

  const result = await orchestrator.delete("cluster-a");

  assert.equal(result.provider, "pgvector-fallback");
  assert.equal(result.result, true);
});

test("capability-aware resilient orchestrator does not retry writes by default", async () => {
  const counters: ProviderCounters = { upserts: 0, deletes: 0 };
  const orchestrator = createCapabilityAwareAnnOrchestrator([
    {
      name: "pgvector-primary",
      provider: provider("pgvector-primary", { failUpsert: true, counters }),
      priority: 10,
      capabilities: { persistence: "durable", metadataFiltering: true }
    }
  ], {
    requirement: { metadataFiltering: true },
    failOpen: false,
    retryPolicy: {
      attempts: 5
    }
  });

  await assert.rejects(() => orchestrator.upsert("cluster-a", { values: [1, 2, 3] }));
  assert.equal(counters.upserts, 1);
});

test("capability-aware resilient orchestrator respects fail-closed semantics", async () => {
  const orchestrator = createCapabilityAwareAnnOrchestrator(candidates(), {
    requirement: { persistence: "durable", metadataFiltering: true },
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
