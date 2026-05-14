import test from "node:test";
import assert from "node:assert/strict";

import {
  filterAnnProvidersByDeployment,
  selectAnnProviderByDeployment,
  type CapableAnnProviderCandidate
} from "../src/index.js";

function candidates(): CapableAnnProviderCandidate[] {
  return [
    { name: "memory", provider: {} as never, priority: 1, capabilities: { persistence: "none" } },
    { name: "pglite", provider: {} as never, priority: 5, capabilities: { persistence: "local", snapshots: true } },
    {
      name: "pgvector",
      provider: {} as never,
      priority: 10,
      capabilities: { persistence: "durable", metadataFiltering: true, transactions: true }
    }
  ];
}

test("browser deployment prefers local providers", () => {
  const selected = selectAnnProviderByDeployment(candidates(), {
    environment: "browser"
  });

  assert.equal(selected?.provider, "pglite");
});

test("server deployment prefers durable providers", () => {
  const selected = selectAnnProviderByDeployment(candidates(), {
    environment: "server"
  });

  assert.equal(selected?.provider, "pgvector");
});

test("deployment routing respects capability requirements", () => {
  const selected = selectAnnProviderByDeployment(candidates(), {
    environment: "server",
    requirement: { metadataFiltering: true }
  });

  assert.equal(selected?.provider, "pgvector");
});

test("deployment routing can reject ephemeral fallback", () => {
  const filtered = filterAnnProvidersByDeployment(candidates(), {
    environment: "hybrid",
    allowEphemeralFallback: false
  });

  assert.equal(filtered.some((candidate) => candidate.name === "memory"), false);
});

test("deployment routing can require durable writes", () => {
  const selected = selectAnnProviderByDeployment(candidates(), {
    requireDurableWrites: true
  });

  assert.equal(selected?.provider, "pgvector");
});
