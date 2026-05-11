import { rerankMultiObjective } from "../multi-objective.js";

describe("rerankMultiObjective", () => {
  it("boosts novelty for unseen clusters", () => {
    const ranked = rerankMultiObjective([
      { clusterId: "gaming", score: 10, category: "gaming", seenRecently: true },
      { clusterId: "fitness", score: 9, category: "fitness", seenRecently: false }
    ]);

    expect(ranked[0]?.clusterId).toBe("fitness");
  });

  it("applies diversity penalties for repeated categories", () => {
    const ranked = rerankMultiObjective([
      { clusterId: "ps5", score: 10, category: "gaming" },
      { clusterId: "xbox", score: 9.9, category: "gaming" },
      { clusterId: "nba", score: 9.8, category: "sports" }
    ]);

    expect(ranked[1]?.clusterId).toBe("nba");
  });
});
