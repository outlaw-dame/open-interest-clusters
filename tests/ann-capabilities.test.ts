import test from "node:test";
import assert from "node:assert/strict";

import {
  annProviderSatisfiesCapabilities,
  getAnnProviderCapabilities,
  normalizeAnnProviderCapabilities,
  selectAnnProviderForCapabilities,
  type AnnProvider,
  type CapableAnnProviderCandidate
} from "../src/index.js";

function provider(): AnnProvider {
  return {
    async upsert() {},
    async delete() {
      return true;
    },
    async search() {
      return [];
    },
    async stats() {
      return { size: 0, dimensions: 0 };
    }
  };
}

test("ANN provider capabilities normalize to safe defaults", () => {
  assert.deepEqual(normalizeAnnProviderCapabilities(undefined), {
    persistence: "none",
    approximateSearch: false,
    metadataFiltering: false,
    namespaces: false,
    snapshots: false,
    transactions: false,
    hybridSparseDense: false
  });
});

test("ANN persistence capability ranking is monotonic", () => {
  assert.equal(
    annProviderSatisfiesCapabilities({ persistence: "durable" }, { persistence: "local" }),
    true
  );
  assert.equal(
    annProviderSatisfiesCapabilities({ persistence: "local" }, { persistence: "durable" }),
    false
  );
});

test("ANN boolean capabilities must be explicitly supported", () => {
  assert.equal(
    annProviderSatisfiesCapabilities({ metadataFiltering: true }, { metadataFiltering: true }),
    true
  );
  assert.equal(
    annProviderSatisfiesCapabilities({ metadataFiltering: false }, { metadataFiltering: true }),
    false
  );
  assert.equal(
    annProviderSatisfiesCapabilities({ hybridSparseDense: true }, { hybridSparseDense: true }),
    true
  );
});

test("ANN capability selection prefers highest priority matching provider", () => {
  const candidates: CapableAnnProviderCandidate[] = [
    {
      name: "memory",
      provider: provider(),
      priority: 1,
      capabilities: { persistence: "none" }
    },
    {
      name: "pglite",
      provider: provider(),
      priority: 5,
      capabilities: { persistence: "local", snapshots: true }
    },
    {
      name: "pgvector",
      provider: provider(),
      priority: 10,
      capabilities: { persistence: "durable", snapshots: true }
    }
  ];

  const selection = selectAnnProviderForCapabilities(candidates, {
    persistence: "local",
    snapshots: true
  });

  assert.equal(selection?.provider, "pgvector");
});

test("ANN capability selection returns null when no provider matches", () => {
  const candidates: CapableAnnProviderCandidate[] = [
    {
      name: "memory",
      provider: provider(),
      capabilities: { persistence: "none" }
    }
  ];

  assert.equal(selectAnnProviderForCapabilities(candidates, { metadataFiltering: true }), null);
});

test("ANN capability introspection returns normalized provider states", () => {
  const states = getAnnProviderCapabilities([
    {
      name: "memory",
      provider: provider(),
      priority: 3
    }
  ]);

  assert.deepEqual(states, [
    {
      provider: "memory",
      priority: 3,
      capabilities: {
        persistence: "none",
        approximateSearch: false,
        metadataFiltering: false,
        namespaces: false,
        snapshots: false,
        transactions: false,
        hybridSparseDense: false
      }
    }
  ]);
});
