import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryRecommendationLabelerDiscoveryRegistry,
  normalizeRecommendationLabelerDiscoveryObservation,
  type RecommendationLabelerDiscoveryObservationInput
} from "../src/recommendation/labeler-discovery.js";

const DID = "did:plc:labelerexample123";

function observation(
  overrides: Partial<RecommendationLabelerDiscoveryObservationInput> = {}
): RecommendationLabelerDiscoveryObservationInput {
  return {
    source: "user_provided",
    discoveredAt: "2026-08-02T00:00:00Z",
    didDocument: {
      id: DID,
      service: [{
        id: `${DID}#atproto_labeler`,
        type: "AtprotoLabeler",
        serviceEndpoint: "https://labels.example.com"
      }]
    },
    declaration: {
      type: "app.bsky.labeler.service",
      recordKey: "self",
      createdAt: "2026-08-01T00:00:00Z",
      labelValues: ["spam", "sports.nba", "spam"],
      subjectTypes: ["record"],
      subjectCollections: ["app.bsky.feed.post"]
    },
    ...overrides
  };
}

test("labeler discovery verifies DID service metadata without creating trust or subscription", () => {
  const candidate = normalizeRecommendationLabelerDiscoveryObservation(observation());

  assert.equal(candidate.labelerDid, DID);
  assert.equal(candidate.serviceEndpoint, "https://labels.example.com/");
  assert.equal(candidate.verification, "did_document_and_declaration");
  assert.deepEqual(candidate.declaredLabelValues, ["spam", "sports.nba"]);
  assert.equal(candidate.requiresExplicitSubscription, true);
  assert.match(candidate.discoveryKey, /^labeler-discovery:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(candidate).includes("subjectId"), false);
  assert.equal(Object.isFrozen(candidate), true);
});

test("labeler discovery supports a DID-only candidate with empty declared policy", () => {
  const candidate = normalizeRecommendationLabelerDiscoveryObservation(
    observation({ declaration: undefined })
  );

  assert.equal(candidate.verification, "did_document");
  assert.deepEqual(candidate.declaredLabelValues, []);
  assert.deepEqual(candidate.declaredSubjectTypes, []);
  assert.deepEqual(candidate.declaredSubjectCollections, []);
});

test("labeler discovery requires exactly one matching labeler service", () => {
  assert.throws(
    () => normalizeRecommendationLabelerDiscoveryObservation(observation({
      didDocument: { id: DID, service: [] }
    })),
    /requires exactly one matching ATProto labeler service/u
  );

  assert.throws(
    () => normalizeRecommendationLabelerDiscoveryObservation(observation({
      didDocument: {
        id: DID,
        service: [
          { id: `${DID}#atproto_labeler`, type: "AtprotoLabeler", serviceEndpoint: "https://one.example.com" },
          { id: `${DID}#atproto_labeler`, type: "AtprotoLabeler", serviceEndpoint: "https://two.example.com" }
        ]
      }
    })),
    /requires exactly one matching ATProto labeler service/u
  );
});

test("labeler discovery rejects unsafe or non-canonical service endpoints", () => {
  for (const serviceEndpoint of [
    "http://labels.example.com",
    "https://user:pass@labels.example.com",
    "https://labels.example.com/xrpc",
    "https://labels.example.com/?token=secret",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]"
  ]) {
    assert.throws(
      () => normalizeRecommendationLabelerDiscoveryObservation(observation({
        didDocument: {
          id: DID,
          service: [{ id: `${DID}#atproto_labeler`, type: "AtprotoLabeler", serviceEndpoint }]
        }
      })),
      /Invalid recommendation labeler discovery service endpoint/u
    );
  }
});

test("labeler discovery rejects malformed declaration identity and policy values", () => {
  assert.throws(
    () => normalizeRecommendationLabelerDiscoveryObservation(observation({
      declaration: {
        type: "app.bsky.labeler.service",
        recordKey: "other" as "self",
        createdAt: "2026-08-01T00:00:00Z",
        labelValues: ["spam"]
      }
    })),
    /declaration identity/u
  );

  assert.throws(
    () => normalizeRecommendationLabelerDiscoveryObservation(observation({
      declaration: {
        type: "app.bsky.labeler.service",
        recordKey: "self",
        createdAt: "2026-08-01T00:00:00Z",
        labelValues: [" bad "]
      }
    })),
    /label policy/u
  );
});

test("labeler discovery registry deterministically keeps the newest observation", () => {
  const registry = createInMemoryRecommendationLabelerDiscoveryRegistry();
  registry.upsert(observation({ discoveredAt: "2026-08-02T01:00:00Z" }));
  registry.upsert(observation({
    discoveredAt: "2026-08-02T00:00:00Z",
    source: "imported",
    didDocument: {
      id: DID,
      service: [{
        id: `${DID}#atproto_labeler`,
        type: "AtprotoLabeler",
        serviceEndpoint: "https://older.example.com"
      }]
    }
  }));

  const candidate = registry.get(DID);
  assert.equal(candidate?.serviceEndpoint, "https://labels.example.com/");
  assert.equal(candidate?.source, "user_provided");
  assert.equal(registry.list().length, 1);
});

test("labeler discovery registry resolves equal-time conflicts independently of delivery order", () => {
  const first = observation({ declaration: undefined });
  const second = observation({
    declaration: undefined,
    didDocument: {
      id: DID,
      service: [{
        id: `${DID}#atproto_labeler`,
        type: "AtprotoLabeler",
        serviceEndpoint: "https://alternate.example.com"
      }]
    }
  });

  const left = createInMemoryRecommendationLabelerDiscoveryRegistry();
  left.upsert(first);
  left.upsert(second);

  const right = createInMemoryRecommendationLabelerDiscoveryRegistry();
  right.upsert(second);
  right.upsert(first);

  assert.deepEqual(left.get(DID), right.get(DID));
});

test("labeler discovery registry removes only discovery metadata", () => {
  const registry = createInMemoryRecommendationLabelerDiscoveryRegistry();
  registry.upsert(observation());

  assert.equal(registry.remove(DID), true);
  assert.equal(registry.get(DID), undefined);
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.remove(DID), false);
});
