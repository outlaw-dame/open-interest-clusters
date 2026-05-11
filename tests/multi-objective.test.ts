import test from "node:test";
import assert from "node:assert/strict";

import { rerankMultiObjective } from "../src/scoring/multi-objective.js";

test("adds a positive novelty component for unseen clusters", () => {
  const ranked = rerankMultiObjective([
    { clusterId: "gaming", score: 10, category: "gaming", seenRecently: true },
    { clusterId: "fitness", score: 9, category: "fitness", seenRecently: false }
  ]);

  const fitness = ranked.find((item) => item.clusterId === "fitness");
  const gaming = ranked.find((item) => item.clusterId === "gaming");

  assert.equal(fitness?.components.novelty, 0.15);
  assert.equal(gaming?.components.novelty, 0);
});

test("applies diversity penalties for repeated categories", () => {
  const ranked = rerankMultiObjective([
    { clusterId: "ps5", score: 10, category: "gaming" },
    { clusterId: "xbox", score: 9.9, category: "gaming" },
    { clusterId: "nba", score: 9.8, category: "sports" }
  ]);

  assert.equal(ranked[1]?.clusterId, "nba");
});
