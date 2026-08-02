import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationAtprotoSubscribeLabelsClient,
  type RecommendationAtprotoSubscribeLabelsTransport
} from "../src/recommendation/atproto-subscribe-labels-client.js";
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

function transportWithSignature(sig: Uint8Array): RecommendationAtprotoSubscribeLabelsTransport {
  return {
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
  };
}

test("subscribeLabels rejects signature bytes above the encoded signature limit before normalization", async () => {
  const client = createRecommendationAtprotoSubscribeLabelsClient(
    transportWithSignature(new Uint8Array(1_537))
  );

  await assert.rejects(
    client.consume({ subjectId: SUBJECT, labeler, subscription }),
    /label signature/u
  );
});

test("subscribeLabels accepts the largest byte signature representable within the string limit", async () => {
  const client = createRecommendationAtprotoSubscribeLabelsClient(
    transportWithSignature(new Uint8Array(1_536))
  );

  const result = await client.consume({ subjectId: SUBJECT, labeler, subscription });
  assert.equal(result.labels[0]?.signature?.length, 2_048);
});
