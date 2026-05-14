import test from "node:test";
import assert from "node:assert/strict";

import {
  ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  createAdaptiveCapabilityAnnOrchestrator,
  createAdaptiveAnnConfigManager,
  createAnnConfigSnapshot,
  type AnnConfigManagerEvent,
  type AnnConfigSnapshot,
  type AnnProvider,
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

function failingReconfigureAdaptive() {
  return {
    reconfigure() {
      throw new Error("reconfigure failed");
    },
    async upsert() { return { provider: "failing", capabilities: {}, result: undefined }; },
    async delete() { return { provider: "failing", capabilities: {}, result: true }; },
    async search() { return { provider: "failing", capabilities: {}, result: [] }; },
    async stats() { return { provider: "failing", capabilities: {}, result: { size: 0, dimensions: 0 } }; },
    getRetryMetrics() { return { attempts: 0, retryableFailures: 0, nonRetryableFailures: 0, fallbackActivations: 0, exhaustedOperations: 0 }; },
    getProviderHealth() { return []; },
    getCircuitState() { return { providers: [] }; },
    getRecentEvents() { return []; },
    async probeProviders() { return []; }
  } as never;
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

test("config manager bounds event history", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  }, { maxEventHistory: 3 });

  manager.applyConfig({ profile: "browser", requirement: { metadataFiltering: true } });
  assert.throws(() => manager.applyConfig({ profile: "desktop" }));
  manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } });
  manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } });
  assert.throws(() => manager.applyConfig({ profile: "browser", deployment: { requireDurableWrites: true } }));

  const events = manager.getRecentEvents();
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.type), ["config-applied", "config-noop", "config-rejected"]);
});

test("config manager event history is deeply immutable from callers", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });

  manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } });
  const events = manager.getRecentEvents();
  const applied = events[0];
  assert.equal(applied?.type, "config-applied");
  if (applied?.type === "config-applied") {
    applied.diff.changed = false;
  }

  const fresh = manager.getRecentEvents()[0];
  assert.equal(fresh?.type, "config-applied");
  if (fresh?.type === "config-applied") {
    assert.equal(fresh.diff.changed, true);
  }
});

test("config manager callback events cannot mutate history", () => {
  const callbackEvents: AnnConfigManagerEvent[] = [];
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  }, {
    onEvent: (event) => {
      if (event.type === "config-applied") event.diff.changed = false;
      callbackEvents.push(event);
    }
  });

  manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } });

  const stored = manager.getRecentEvents()[0];
  assert.equal(callbackEvents[0]?.type, "config-applied");
  assert.equal(stored?.type, "config-applied");
  if (stored?.type === "config-applied") assert.equal(stored.diff.changed, true);
});

test("config manager rolls back snapshot when valid config reconfigure fails", () => {
  const manager = createAdaptiveAnnConfigManager(failingReconfigureAdaptive(), {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const before = manager.getSnapshot();

  assert.throws(() => manager.applyConfig({ profile: "server", requirement: { metadataFiltering: true } }));

  assert.equal(manager.getSnapshot().fingerprint, before.fingerprint);
  assert.equal(manager.getRecentEvents().at(-1)?.type, "config-rejected");
});

test("config manager restores valid snapshots", async () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const serverSnapshot = createAnnConfigSnapshot({ profile: "server", requirement: { metadataFiltering: true } });

  manager.restoreSnapshot(serverSnapshot);

  assert.equal(manager.getSnapshot().fingerprint, serverSnapshot.fingerprint);
  assert.equal((await adaptive.search({ values: [1, 2, 3] })).provider, "pgvector");
});

test("config manager rolls back snapshot when restore reconfigure fails", () => {
  const manager = createAdaptiveAnnConfigManager(failingReconfigureAdaptive(), {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const before = manager.getSnapshot();
  const serverSnapshot = createAnnConfigSnapshot({ profile: "server", requirement: { metadataFiltering: true } });

  assert.throws(() => manager.restoreSnapshot(serverSnapshot));

  assert.equal(manager.getSnapshot().fingerprint, before.fingerprint);
  assert.equal(manager.getRecentEvents().at(-1)?.type, "config-rejected");
});

test("config manager rejects restored snapshots with unsupported schema", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });
  const tampered = { ...snapshot, schemaVersion: 999 as typeof ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION };

  assert.throws(() => manager.restoreSnapshot(tampered));
});

test("config manager rejects restored snapshots with invalid timestamp", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });
  const tampered: AnnConfigSnapshot = { ...snapshot, createdAt: "not-a-date" };

  assert.throws(() => manager.restoreSnapshot(tampered));
});

test("config manager rejects restored snapshots with mismatched fingerprint", () => {
  const adaptive = createAdaptiveCapabilityAnnOrchestrator(candidates, {
    requirement: { metadataFiltering: true },
    deployment: { environment: "browser" }
  });
  const manager = createAdaptiveAnnConfigManager(adaptive, {
    profile: "browser",
    requirement: { metadataFiltering: true }
  });
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });
  const tampered: AnnConfigSnapshot = { ...snapshot, fingerprint: "sha256:bad" };

  assert.throws(() => manager.restoreSnapshot(tampered));
});
