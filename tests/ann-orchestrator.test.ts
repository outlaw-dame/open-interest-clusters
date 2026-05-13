import test from "node:test";
import assert from "node:assert/strict";

import {
  AnnProviderOrchestrator,
  createBrowserAnnStack,
  createDurableAnnStack,
  createHybridAnnStack,
  createServerAnnStack,
  type AnnProvider
} from "../src/index.js";

function provider(
  name: string,
  options: {
    failSearch?: boolean;
    failStats?: boolean;
    transientSearchFailures?: number;
    hangingHealthCheck?: boolean;
  } = {}
): AnnProvider {
  let transientFailures = options.transientSearchFailures ?? 0;

  return {
    async upsert() {},
    async delete() {
      return true;
    },
    async search() {
      if (transientFailures > 0) {
        transientFailures -= 1;
        const error = new Error(`${name} transient failure`) as Error & { code?: string };
        error.code = "ECONNRESET";
        throw error;
      }

      if (options.failSearch === true) {
        throw new Error(`${name} search failed`);
      }

      return [{ clusterId: name, similarity: 1 }];
    },
    async stats() {
      if (options.hangingHealthCheck === true) {
        return new Promise(() => undefined);
      }

      if (options.failStats === true) {
        throw new Error(`${name} stats failed`);
      }

      return { size: 1, dimensions: 3 };
    }
  };
}

test("ANN orchestrator respects custom health checks", async () => {
  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "primary",
      provider: provider("primary"),
      priority: 10,
      healthCheck: async () => false
    },
    {
      name: "fallback",
      provider: provider("fallback"),
      priority: 1
    }
  ]);

  const selection = await orchestrator.selection();
  const results = await orchestrator.search({ values: [1, 2, 3] });

  assert.equal(selection.activeProvider, "fallback");
  assert.deepEqual(results, [{ clusterId: "fallback", similarity: 1 }]);
});

test("ANN orchestrator retries transient read failures with observability", async () => {
  const events: string[] = [];
  const delays: number[] = [];

  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "primary",
      provider: provider("primary", { transientSearchFailures: 1 })
    }
  ], {
    retryPolicy: {
      attempts: 2
    },
    random: () => 0,
    retrySleeper: async (delayMs) => {
      delays.push(delayMs);
    },
    onEvent: async (event) => {
      events.push(event.type);
    }
  });

  const results = await orchestrator.search({ values: [1, 2, 3] });
  const metrics = orchestrator.getRetryMetrics();

  assert.deepEqual(results, [{ clusterId: "primary", similarity: 1 }]);
  assert.deepEqual(delays, [100]);
  assert.ok(events.includes("provider_retry"));
  assert.equal(metrics.providerRetries, 1);
});

test("ANN orchestrator opens circuit and reports health state", async () => {
  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "primary",
      provider: provider("primary", { failSearch: true })
    }
  ], {
    failOpen: false,
    circuitBreakerThreshold: 1,
    failureCooldownMs: 10_000
  });

  await assert.rejects(() => orchestrator.search({ values: [1, 2, 3] }));

  const circuit = orchestrator.getCircuitState();
  const health = orchestrator.getProviderHealth()[0];
  assert.ok(health);

  assert.deepEqual(circuit.openProviders, ["primary"]);
  assert.equal(health.circuitOpen, true);
  assert.equal(health.failureCount, 1);
});

test("ANN event history remains bounded and immutable", async () => {
  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "primary",
      provider: provider("primary", { transientSearchFailures: 3 })
    }
  ], {
    eventHistoryLimit: 2,
    retryPolicy: {
      attempts: 4
    },
    random: () => 0,
    retrySleeper: async () => undefined
  });

  await orchestrator.search({ values: [1, 2, 3] });

  const first = orchestrator.getRecentEvents();
  assert.equal(first.length, 2);
  const firstEvent = first[0];
  assert.ok(firstEvent);
  firstEvent.provider = "tampered";

  const second = orchestrator.getRecentEvents();
  const secondEvent = second[0];
  assert.ok(secondEvent);
  assert.notEqual(secondEvent.provider, "tampered");
});

test("ANN health probe timeout skips hanging providers", async () => {
  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "hung",
      provider: provider("hung", { hangingHealthCheck: true }),
      priority: 10
    },
    {
      name: "fallback",
      provider: provider("fallback"),
      priority: 1
    }
  ], {
    healthProbeTimeoutMs: 1
  });

  const selection = await orchestrator.selection();
  assert.equal(selection.activeProvider, "fallback");
});

test("ANN orchestrator promotes fallback when active provider fails", async () => {
  const orchestrator = new AnnProviderOrchestrator([
    {
      name: "primary",
      provider: provider("primary", { failSearch: true }),
      priority: 10
    },
    {
      name: "fallback",
      provider: provider("fallback"),
      priority: 1
    }
  ]);

  const results = await orchestrator.search({ values: [1, 2, 3] });
  const selection = await orchestrator.selection();
  const metrics = orchestrator.getRetryMetrics();

  assert.deepEqual(results, [{ clusterId: "fallback", similarity: 1 }]);
  assert.equal(selection.activeProvider, "fallback");
  assert.equal(metrics.fallbackActivations, 1);
});

test("ANN profile helpers construct expected stacks", async () => {
  const durable = { name: "durable", provider: provider("durable"), priority: 10 };
  const local = { name: "local", provider: provider("local"), priority: 5 };
  const fallback = { name: "fallback", provider: provider("fallback"), priority: 1 };

  assert.equal((await createHybridAnnStack({ durable, local, fallback }).selection()).activeProvider, "durable");
  assert.equal((await createServerAnnStack({ durable, local, fallback }).selection()).activeProvider, "durable");
  assert.equal((await createBrowserAnnStack({ durable, local, fallback }).selection()).activeProvider, "local");
  assert.equal((await createDurableAnnStack({ durable, local, fallback }).selection()).activeProvider, "durable");
});

test("durable ANN profile requires durable provider", () => {
  assert.throws(() => createDurableAnnStack({ fallback: { name: "fallback", provider: provider("fallback") } }));
});
