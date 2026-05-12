import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryAnnProvider } from "../src/index.js";

test("in-memory ANN returns similarity-ranked results", async () => {
  const provider = new InMemoryAnnProvider();

  await provider.upsert("gaming", {
    values: [1, 0]
  });

  await provider.upsert("books", {
    values: [0, 1]
  });

  const results = await provider.search({
    values: [1, 0]
  });

  assert.equal(results[0]?.clusterId, "gaming");
});

test("in-memory ANN rejects vector dimension mismatch", async () => {
  const provider = new InMemoryAnnProvider();

  await provider.upsert("gaming", {
    values: [1, 0]
  });

  await assert.rejects(async () => {
    await provider.upsert("books", {
      values: [1, 0, 0]
    });
  });
});

test("in-memory ANN rejects malformed cluster ids", async () => {
  const provider = new InMemoryAnnProvider();

  await assert.rejects(async () => {
    await provider.upsert("bad\u0000id", {
      values: [1, 0]
    });
  });
});

test("in-memory ANN exposes stable stats", async () => {
  const provider = new InMemoryAnnProvider();

  await provider.upsert("gaming", {
    values: [1, 0]
  });

  const stats = await provider.stats();

  assert.equal(stats.size, 1);
  assert.equal(stats.dimensions, 2);
});
