import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryRecommendationLabelerDiscoveryRegistry,
  normalizeRecommendationLabelerDiscoveryObservation,
  type RecommendationLabelerDiscoveryObservationInput
} from "../src/recommendation/labeler-discovery.js";

const DID = "did:plc:labelerleapboundary";

function observation(
  discoveredAt: string,
  source: RecommendationLabelerDiscoveryObservationInput["source"] = "user_provided"
): RecommendationLabelerDiscoveryObservationInput {
  return {
    source,
    discoveredAt,
    didDocument: {
      id: DID,
      service: [{
        id: `${DID}#atproto_labeler`,
        type: "AtprotoLabeler",
        serviceEndpoint: "https://labels.example.com"
      }]
    }
  };
}

test("labeler discovery rejects second 60 outside a UTC month-end leap position", () => {
  for (const discoveredAt of [
    "2026-08-02T12:34:60Z",
    "2026-08-31T22:59:60Z",
    "2026-09-01T00:59:60+01:00",
    "2026-08-31T23:59:60+01:00"
  ]) {
    assert.throws(
      () => normalizeRecommendationLabelerDiscoveryObservation(observation(discoveredAt)),
      /Invalid recommendation labeler discovery timestamp/u
    );
  }
});

test("labeler discovery accepts offset timestamps that map to UTC month end", () => {
  assert.doesNotThrow(() => normalizeRecommendationLabelerDiscoveryObservation(
    observation("2017-01-01T00:59:60+01:00")
  ));
  assert.doesNotThrow(() => normalizeRecommendationLabelerDiscoveryObservation(
    observation("2016-12-31T18:59:60-05:00")
  ));
});

test("labeler discovery orders leap seconds before the following UTC midnight", () => {
  const registry = createInMemoryRecommendationLabelerDiscoveryRegistry();
  registry.upsert(observation("2016-12-31T23:59:60Z", "imported"));
  registry.upsert(observation("2017-01-01T00:00:00Z", "user_provided"));

  assert.equal(registry.get(DID)?.discoveredAt, "2017-01-01T00:00:00Z");
});

test("labeler discovery preserves ordering within a fractional leap second", () => {
  const registry = createInMemoryRecommendationLabelerDiscoveryRegistry();
  registry.upsert(observation("2016-12-31T23:59:60.125Z", "imported"));
  registry.upsert(observation("2016-12-31T23:59:60.9Z", "user_provided"));

  assert.equal(registry.get(DID)?.discoveredAt, "2016-12-31T23:59:60.9Z");

  registry.upsert(observation("2017-01-01T00:00:00Z", "atproto_profile"));
  assert.equal(registry.get(DID)?.discoveredAt, "2017-01-01T00:00:00Z");
});

test("labeler discovery resolves equivalent offset leap instants deterministically", () => {
  const left = createInMemoryRecommendationLabelerDiscoveryRegistry();
  left.upsert(observation("2016-12-31T23:59:60Z", "imported"));
  left.upsert(observation("2017-01-01T00:59:60+01:00", "user_provided"));

  const right = createInMemoryRecommendationLabelerDiscoveryRegistry();
  right.upsert(observation("2017-01-01T00:59:60+01:00", "user_provided"));
  right.upsert(observation("2016-12-31T23:59:60Z", "imported"));

  assert.deepEqual(left.get(DID), right.get(DID));
});
