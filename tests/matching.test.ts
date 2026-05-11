import test from "node:test";
import assert from "node:assert/strict";
import { buildClusterIndex } from "../src/matching/index.js";
import { resolveClustersFromHashtag } from "../src/matching/resolve-hashtag.js";
import { matchTextToClusters } from "../src/matching/match-text.js";
import type { InterestClusterDataset } from "../src/types/schema.js";
import datasetJson from "../datasets/interests.global.v1.json" with { type: "json" };

const dataset = datasetJson as InterestClusterDataset;

test("resolveClustersFromHashtag resolves gaming hashtag", () => {
  const index = buildClusterIndex(dataset);
  const result = resolveClustersFromHashtag("#PS5", index);
  assert.ok(result.includes("gaming"));
});

test("matchTextToClusters matches gaming context", () => {
  const index = buildClusterIndex(dataset);

  const results = matchTextToClusters(
    "New PS5 Pro performance looks insane",
    ["PS5Pro"],
    index
  );

  assert.ok(results[0]);
  assert.equal(results[0]?.clusterId, "gaming");
});

test("negative keywords suppress incorrect matches", () => {
  const index = buildClusterIndex(dataset);

  const results = matchTextToClusters(
    "Apple pie recipe with cinnamon",
    [],
    index
  );

  assert.ok(!results.some((result) => result.clusterId === "technology.apple"));
});
