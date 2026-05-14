import test from "node:test";
import assert from "node:assert/strict";

import {
  annDeploymentForProfile,
  createProfiledAnnOrchestrator,
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
    name: "memory",
    provider: provider("memory"),
    priority: 1,
    capabilities: { persistence: "none" }
  },
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

test("deployment profile mappings are stable", () => {
  assert.deepEqual(annDeploymentForProfile("browser"), {
    environment: "browser",
    preferLocalFirst: true
  });

  assert.deepEqual(annDeploymentForProfile("server"), {
    environment: "server",
    requireDurableWrites: true,
    allowEphemeralFallback: false
  });
});

test("profiled browser orchestrator prefers local providers", async () => {
  const orchestrator = createProfiledAnnOrchestrator(candidates, "browser", {
    requirement: { metadataFiltering: true }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pglite");
});

test("profiled server orchestrator prefers durable providers", async () => {
  const orchestrator = createProfiledAnnOrchestrator(candidates, "server", {
    requirement: { metadataFiltering: true }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pgvector");
});
