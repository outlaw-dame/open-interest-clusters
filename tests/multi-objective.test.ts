import test from "node:test";
import assert from "node:assert/strict";

import { rerankMultiObjective } from "../src/scoring/multi-objective.js";

test("boosts novelty for unseen clusters", () => {
  const ranked = rerankMultiObjective([
    { clusterId: "gaming", score: 10, category: "gaming", seenRecently: true },
    { clusterId: "fitness", score: 9, category: "fitness", seenRecently: false }
  ]);

  assert.equal(ranked[0]?.clusterId, "fitness");
});

test("applies diversity penalties for repeated categories", () => {
  const ranked = rerankMultiObjective([
    { clusterId: "ps5", score: 10, category: "gaming" },
    { clusterId: "xbox", score: 9.9, category: "gaming" },
    { clusterId: "nba", score: 9.8, category: "sports" }
  ]);

  assert.equal(ranked[1]?.clusterId, "nba");
});
