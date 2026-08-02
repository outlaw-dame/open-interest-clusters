import test from "node:test";
import assert from "node:assert/strict";

import { createRecommendationAtprotoSubscribeLabelsClient } from "../src/recommendation/atproto-subscribe-labels-client.js";
import type { RecommendationDiscoveredLabeler } from "../src/recommendation/labeler-discovery.js";

const DID = "did:plc:subscribelabelsservice";
const SUBJECT = "subject-1";

const labeler: RecommendationDiscoveredLabeler = {
  discoveryKey: "hashed-discovery-key",
  labelerDid: DID,
  serviceEndpoint: "https://labels.example.com",
  source: "user_provided",
  discoveredAt: "2026-08-02T11:00:00Z",
  verification: "did_document",
  declaredLabelValues: [],
  declaredSubjectTypes: [],
  declaredSubjectCollections: [],
  requiresExplicitSubscription: true
};

const subscription = {
  subjectId: SUBJECT,
  labelerDid: DID,
  source: "atproto" as const,
  subscribedAt: "2026-08-02T11:01:00Z"
};

function clientFor(sig: unknown) {
  return createRecommendationAtprotoSubscribeLabelsClient({
    subscribe() {
      return (async function* () {
        yield {
          seq: 1,
          labels: [{
            src: DID,
            uri: "at://did:plc:author/app.bsky.feed.post/abc",
            val: "topic-news",
            cts: "2026-08-02T11:02:00Z",
            sig
          }]
        };
      })();
    }
  });
}

test("subscribeLabels converts DAG-CBOR signature bytes to canonical base64", async () => {
  const result = await clientFor(new Uint8Array([0, 1, 2, 253, 254, 255])).consume({
    subjectId: SUBJECT,
    labeler,
    subscription
  });

  assert.equal(result.labels[0]?.signature, "AAEC/f7/");
});

test("subscribeLabels preserves an already normalized string signature", async () => {
  const result = await clientFor("AAEC/f7/").consume({ subjectId: SUBJECT, labeler, subscription });
  assert.equal(result.labels[0]?.signature, "AAEC/f7/");
});

test("subscribeLabels rejects unsupported signature representations", async () => {
  await assert.rejects(
    clientFor([0, 1, 2]).consume({ subjectId: SUBJECT, labeler, subscription }),
    /signature/u
  );
});
