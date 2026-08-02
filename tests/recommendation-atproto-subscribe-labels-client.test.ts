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

function rawLabel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    src: DID,
    uri: "at://did:plc:author/app.bsky.feed.post/abc",
    val: "topic-news",
    cts: "2026-08-02T11:02:00Z",
    ...overrides
  };
}

function transportWith(messages: readonly unknown[]): {
  transport: RecommendationAtprotoSubscribeLabelsTransport;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    transport: {
      subscribe(input) {
        urls.push(input.url);
        return (async function* () {
          for (const message of messages) yield message;
        })();
      }
    }
  };
}

test("subscribeLabels requires an explicit matching active subscription before opening transport", async () => {
  const { transport, urls } = transportWith([]);
  const client = createRecommendationAtprotoSubscribeLabelsClient(transport);

  await assert.rejects(
    client.consume({
      subjectId: SUBJECT,
      labeler,
      subscription: { ...subscription, labelerDid: "did:plc:other" }
    }),
    /matching explicit subscription/u
  );
  await assert.rejects(
    client.consume({
      subjectId: SUBJECT,
      labeler,
      subscription: { ...subscription, revokedAt: "2026-08-02T11:03:00Z" }
    }),
    /revoked/u
  );
  assert.equal(urls.length, 0);
});

test("subscribeLabels constructs the WebSocket XRPC URL and normalizes frames", async () => {
  const { transport, urls } = transportWith([
    { seq: 11, labels: [rawLabel()] },
    { seq: 12, labels: [rawLabel({ uri: "at://did:plc:author/app.bsky.feed.post/def", neg: true })] }
  ]);
  const accepted: number[] = [];
  const client = createRecommendationAtprotoSubscribeLabelsClient(transport);
  const result = await client.consume({
    subjectId: SUBJECT,
    labeler,
    subscription,
    cursor: 10,
    onFrame(frame) {
      accepted.push(frame.seq);
    }
  });

  const url = new URL(urls[0] ?? "");
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/xrpc/com.atproto.label.subscribeLabels");
  assert.equal(url.searchParams.get("cursor"), "10");
  assert.deepEqual(accepted, [11, 12]);
  assert.equal(result.frames, 2);
  assert.equal(result.labels.length, 2);
  assert.equal(result.labels[0]?.provenance, "subscribe_labels");
  assert.equal(result.labels[1]?.negated, true);
  assert.equal(result.lastCursor, 12);
  assert.equal(result.truncated, false);
});

test("subscribeLabels advances its checkpoint only after the frame handler succeeds", async () => {
  const { transport } = transportWith([
    { seq: 1, labels: [rawLabel()] },
    { seq: 2, labels: [rawLabel()] }
  ]);
  const client = createRecommendationAtprotoSubscribeLabelsClient(transport);

  await assert.rejects(
    client.consume({
      subjectId: SUBJECT,
      labeler,
      subscription,
      onFrame(frame) {
        if (frame.seq === 2) throw new Error("persist failed");
      }
    }),
    /persist failed/u
  );
});

test("subscribeLabels rejects non-increasing sequences and unexpected labeler DIDs", async () => {
  const duplicate = createRecommendationAtprotoSubscribeLabelsClient(
    transportWith([
      { seq: 5, labels: [rawLabel()] },
      { seq: 5, labels: [rawLabel()] }
    ]).transport
  );
  await assert.rejects(
    duplicate.consume({ subjectId: SUBJECT, labeler, subscription }),
    /sequence did not increase/u
  );

  const wrongSource = createRecommendationAtprotoSubscribeLabelsClient(
    transportWith([{ seq: 1, labels: [rawLabel({ src: "did:plc:other" })] }]).transport
  );
  await assert.rejects(
    wrongSource.consume({ subjectId: SUBJECT, labeler, subscription }),
    /unexpected labeler DID/u
  );
});

test("subscribeLabels surfaces info frames without treating them as labels", async () => {
  const client = createRecommendationAtprotoSubscribeLabelsClient(
    transportWith([{ name: "OutdatedCursor", message: "cursor is outside retained history" }]).transport
  );
  const result = await client.consume({ subjectId: SUBJECT, labeler, subscription, cursor: 1 });

  assert.equal(result.frames, 0);
  assert.equal(result.labels.length, 0);
  assert.deepEqual(result.info, {
    name: "OutdatedCursor",
    message: "cursor is outside retained history"
  });
  assert.equal(result.lastCursor, 1);
});

test("subscribeLabels rejects unsafe endpoints before opening transport", async () => {
  for (const endpoint of [
    "https://localhost",
    "https://localhost.",
    "https://labeler.local.",
    "https://127.0.0.1",
    "https://[::1]"
  ]) {
    const { transport, urls } = transportWith([]);
    const client = createRecommendationAtprotoSubscribeLabelsClient(transport);
    await assert.rejects(
      client.consume({
        subjectId: SUBJECT,
        labeler: { ...labeler, serviceEndpoint: endpoint },
        subscription
      }),
      /service endpoint/u
    );
    assert.equal(urls.length, 0);
  }
});

test("subscribeLabels bounds frames without slicing an accepted label frame", async () => {
  const client = createRecommendationAtprotoSubscribeLabelsClient(
    transportWith([
      { seq: 1, labels: [rawLabel()] },
      { seq: 2, labels: [rawLabel()] }
    ]).transport
  );
  const result = await client.consume({
    subjectId: SUBJECT,
    labeler,
    subscription,
    maxFrames: 1
  });

  assert.equal(result.frames, 1);
  assert.equal(result.labels.length, 1);
  assert.equal(result.lastCursor, 1);
  assert.equal(result.truncated, true);
});

test("subscribeLabels rejects a frame that exceeds the remaining label budget", async () => {
  const client = createRecommendationAtprotoSubscribeLabelsClient(
    transportWith([{ seq: 1, labels: [rawLabel(), rawLabel({ uri: "at://did:plc:author/app.bsky.feed.post/def" })] }]).transport
  );

  await assert.rejects(
    client.consume({
      subjectId: SUBJECT,
      labeler,
      subscription,
      maxLabels: 1
    }),
    /label frame/u
  );
});
