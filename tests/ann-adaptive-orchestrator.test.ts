import test from "node:test";
import assert from "node:assert/strict";

import {
  createAdaptiveCapabilityAnnOrchestrator,
  type CapableAnnProviderCandidate,
  type AnnProvider
} from "../src/index.js";

function provider(name: string): AnnProvider {
  return {
    async upsert() {},
    async delete() { return true; },
    async search() { return [{ clusterId: name, similarity: 1 }]; },
    async stats() { return { size: 1, dimensions: 3 }; }
  };
}

const candidates: CapableAnnProviderCandidate[] = [
  {
    name: "pglite",
    provider: provider("pglite"),
    priority: 5,
    capabilities: { persistence: "local", metadataFiltering: true }
  },
  {
    name: "pgvector",
    provider: provider("pgvector"),
    priority: 10,
    capabilities: { persistence: "durable", metadataFiltering: true }
  }
];

test("adaptive orchestrator can reconfigure browser to server", async () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const browser = await adaptive.search({ values: [1, 2, 3] });
  assert.equal(browser.provider, "pglite");

  adaptive.reconfigure({
    deployment: {
      environment: "server",
      requireDurableWrites: true,
      allowEphemeralFallback: false
    }
  });

  const server = await adaptive.search({ values: [1, 2, 3] });
  assert.equal(server.provider, "pgvector");
});

test("adaptive orchestrator preserves previous orchestrator on invalid reconfiguration", async () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  assert.throws(() => {
    adaptive.reconfigure({
      requirement: { hybridSparseDense: true }
    });
  });

  const result = await adaptive.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pglite");
});

test("adaptive orchestrator resets metrics after rebuild swap", async () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  await adaptive.search({ values: [1, 2, 3] });

  adaptive.reconfigure({
    deployment: { environment: "server", requireDurableWrites: true }
  });

  const metrics = adaptive.getRetryMetrics();
  assert.equal(metrics.fallbackActivations, 0);
});
