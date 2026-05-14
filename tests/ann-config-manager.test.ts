import test from "node:test";
import assert from "node:assert/strict";

import {
  createAdaptiveCapabilityAnnOrchestrator,
  createAdaptiveAnnConfigManager,
  type AnnProvider,
  type AnnConfigManagerEvent,
  type CapableAnnProviderCandidate
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

test("config manager noops identical config", () => {
  const events: AnnConfigManagerEvent[] = [];
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const manager = createAdaptiveAnnConfigManager(
    adaptive,
    { profile: "browser", requirement: { metadataFiltering: true } },
    { onEvent: (event) => events.push(event), now: () => new Date("2026-01-01T00:00:00.000Z") }
  );

  const result = manager.applyConfig({ profile: "browser", requirement: { metadataFiltering: true } });
  assert.equal(result.applied, false);
  assert.equal(events.at(-1)?.type, "config-noop");
});

test("config manager applies browser to server transition", async () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });

  manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } });
  const result = await adaptive.search({ values: [1, 2, 3] });
  assert.equal(result.provider, "pgvector");
});

test("config manager preserves prior snapshot on invalid config", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });

  const before = manager.getSnapshot();

  assert.throws(() => manager.applyConfig({ profile: "desktop" }));

  const after = manager.getSnapshot();
  assert.equal(after.fingerprint, before.fingerprint);
});

test("config manager emits rejection event", () => {
  const events: AnnConfigManagerEvent[] = [];
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  }, {
    onEvent: (event) => events.push(event)
  });

  assert.throws(() => manager.applyConfig({ profile: "desktop" }));
  assert.equal(events.at(-1)?.type, "config-rejected");
});

test("config manager snapshot is defensive clone", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });

  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });

  const snapshot = manager.getSnapshot();
  snapshot.config.deployment.environment = "server";

  const fresh = manager.getSnapshot();
  assert.equal(fresh.config.deployment.environment, "browser");
});
