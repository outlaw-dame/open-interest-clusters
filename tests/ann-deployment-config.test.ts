import test from "node:test";
import assert from "node:assert/strict";

import {
  createConfiguredAdaptiveAnnOrchestrator,
  createConfiguredCapabilityAnnOrchestrator,
  validateAnnDeploymentConfig,
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
      return { size: 1, dimensions: 3 };
    }
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

test("deployment config validates server preset", () => {
  const config = validateAnnDeploymentConfig({
    profile: "server",
    requirement: {
      metadataFiltering: true
    }
  });

  assert.equal(config.profile, "server");
  assert.equal(config.deployment.environment, "server");
  assert.equal(config.deployment.requireDurableWrites, true);
});

test("configured capability orchestrator routes browser profile to local provider", async () => {
  const orchestrator = createConfiguredCapabilityAnnOrchestrator(candidates, {
    config: {
      profile: "browser",
      requirement: { metadataFiltering: true }
    }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pglite");
});

test("configured adaptive orchestrator routes server profile to durable provider", async () => {
  const orchestrator = createConfiguredAdaptiveAnnOrchestrator(candidates, {
    config: {
      profile: "server",
      requirement: { metadataFiltering: true }
    }
  });

  const result = await orchestrator.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pgvector");
});

test("deployment config rejects invalid profile", () => {
  assert.throws(() =>
    validateAnnDeploymentConfig({
      profile: "desktop"
    })
  );
});

test("deployment config rejects invalid requirement persistence", () => {
  assert.throws(() =>
    validateAnnDeploymentConfig({
      requirement: {
        persistence: "remote"
      }
    })
  );
});

test("deployment config rejects malformed deployment environment", () => {
  assert.throws(() =>
    validateAnnDeploymentConfig({
      deployment: {
        environment: "phone"
      }
    })
  );
});

test("deployment config rejects malformed booleans", () => {
  assert.throws(() =>
    validateAnnDeploymentConfig({
      deployment: {
        preferLocalFirst: "yes"
      }
    })
  );
});

test("deployment config rejects browser durable-write contradiction", () => {
  assert.throws(() =>
    validateAnnDeploymentConfig({
      profile: "browser",
      deployment: {
        requireDurableWrites: true
      }
    })
  );
});
