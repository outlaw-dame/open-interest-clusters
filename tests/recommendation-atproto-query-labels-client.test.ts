import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationAtprotoQueryLabelsClient,
  type RecommendationAtprotoQueryLabelsTransport
} from "../src/recommendation/atproto-query-labels-client.js";
import type { RecommendationDiscoveredLabeler } from "../src/recommendation/labeler-discovery.js";

const DID = "did:plc:querylabelsservice";
const SUBJECT = "subject-1";
const URI_PATTERNS = ["at://did:plc:author/*"] as const;

const labeler: RecommendationDiscoveredLabeler = {
  discoveryKey: "hashed-discovery-key",
  labelerDid: DID,
  serviceEndpoint: "https://labels.example.com",
  source: "user_provided",
  discoveredAt: "2026-08-01T20:00:00Z",
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
  subscribedAt: "2026-08-01T20:01:00Z"
};

function rawLabel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    src: DID,
    uri: "at://did:plc:author/app.bsky.feed.post/abc",
    val: "topic-news",
    cts: "2026-08-01T20:02:00Z",
    ...overrides
  };
}

function transportWith(responses: unknown[]): { transport: RecommendationAtprotoQueryLabelsTransport; urls: string[] } {
  const urls: string[] = [];
  let index = 0;
  return {
    urls,
    transport: {
      async request(input) {
        urls.push(input.url);
        const response = responses[index++];
        if (response === undefined) throw new Error("Unexpected request.");
        return { status: 200, body: response };
      }
    }
  };
}

test("queryLabels requires an explicit matching active subscription", async () => {
  const { transport } = transportWith([{ labels: [] }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);

  await assert.rejects(
    client.queryPage({
      subjectId: SUBJECT,
      labeler,
      subscription: { ...subscription, labelerDid: "did:plc:other" },
      uriPatterns: URI_PATTERNS
    }),
    /matching explicit subscription/u
  );
  await assert.rejects(
    client.queryPage({
      subjectId: SUBJECT,
      labeler,
      subscription: { ...subscription, revokedAt: "2026-08-01T20:03:00Z" },
      uriPatterns: URI_PATTERNS
    }),
    /revoked/u
  );
});

test("queryLabels requires at least one URI pattern", async () => {
  const { transport, urls } = transportWith([{ labels: [] }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  await assert.rejects(
    client.queryPage({ subjectId: SUBJECT, labeler, subscription, uriPatterns: [] }),
    /URI patterns/u
  );
  assert.equal(urls.length, 0);
});

test("queryLabels constructs the XRPC request and normalizes returned labels", async () => {
  const { transport, urls } = transportWith([{ labels: [rawLabel()], cursor: "next-1" }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  const page = await client.queryPage({
    subjectId: SUBJECT,
    labeler,
    subscription,
    uriPatterns: ["at://did:plc:author/*", "at://did:plc:author/*"],
    sources: [DID],
    limit: 25
  });

  const url = new URL(urls[0] ?? "");
  assert.equal(url.pathname, "/xrpc/com.atproto.label.queryLabels");
  assert.deepEqual(url.searchParams.getAll("uriPatterns"), ["at://did:plc:author/*"]);
  assert.deepEqual(url.searchParams.getAll("sources"), [DID]);
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(page.labels[0]?.provenance, "query_labels");
  assert.equal(page.labels[0]?.labelerDid, DID);
  assert.equal(page.cursor, "next-1");
});

test("queryLabels rejects labels issued by an unexpected source", async () => {
  const { transport } = transportWith([{ labels: [rawLabel({ src: "did:plc:other" })] }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  await assert.rejects(
    client.queryPage({ subjectId: SUBJECT, labeler, subscription, uriPatterns: URI_PATTERNS }),
    /unexpected labeler DID/u
  );
});

test("queryLabels rejects responses larger than the requested page limit", async () => {
  const { transport } = transportWith([{
    labels: [rawLabel({ val: "first" }), rawLabel({ val: "second" })],
    cursor: "after-two"
  }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);

  await assert.rejects(
    client.queryPage({
      subjectId: SUBJECT,
      labeler,
      subscription,
      uriPatterns: URI_PATTERNS,
      limit: 1
    }),
    /Invalid ATProto queryLabels response/u
  );
});

test("queryAll follows bounded pagination and reports truncation", async () => {
  const { transport, urls } = transportWith([
    { labels: [rawLabel({ val: "first" })], cursor: "c1" },
    { labels: [rawLabel({ val: "second", cts: "2026-08-01T20:03:00Z" })], cursor: "c2" }
  ]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  const result = await client.queryAll({
    subjectId: SUBJECT,
    labeler,
    subscription,
    uriPatterns: URI_PATTERNS,
    maxPages: 2,
    maxLabels: 10
  });

  assert.equal(result.pages, 2);
  assert.equal(result.labels.length, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.nextCursor, "c2");
  assert.equal(new URL(urls[1] ?? "").searchParams.get("cursor"), "c1");
});

test("queryAll caps each request to the remaining label budget", async () => {
  const { transport, urls } = transportWith([{ labels: Array.from({ length: 10 }, (_, index) => rawLabel({ val: `topic-${index}` })), cursor: "after-ten" }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  const result = await client.queryAll({
    subjectId: SUBJECT,
    labeler,
    subscription,
    uriPatterns: URI_PATTERNS,
    limit: 100,
    maxLabels: 10
  });

  assert.equal(new URL(urls[0] ?? "").searchParams.get("limit"), "10");
  assert.equal(result.labels.length, 10);
  assert.equal(result.nextCursor, "after-ten");
  assert.equal(result.truncated, true);
});

test("queryAll rejects a server page larger than the remaining label budget", async () => {
  const { transport, urls } = transportWith([{
    labels: [rawLabel({ val: "first" }), rawLabel({ val: "second" })],
    cursor: "after-two"
  }]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);

  await assert.rejects(
    client.queryAll({
      subjectId: SUBJECT,
      labeler,
      subscription,
      uriPatterns: URI_PATTERNS,
      limit: 100,
      maxLabels: 1
    }),
    /Invalid ATProto queryLabels response/u
  );
  assert.equal(new URL(urls[0] ?? "").searchParams.get("limit"), "1");
});

test("queryAll rejects repeated cursors to avoid an infinite loop", async () => {
  const { transport } = transportWith([
    { labels: [rawLabel()], cursor: "same" },
    { labels: [rawLabel({ cts: "2026-08-01T20:03:00Z" })], cursor: "same" }
  ]);
  const client = createRecommendationAtprotoQueryLabelsClient(transport);
  await assert.rejects(
    client.queryAll({ subjectId: SUBJECT, labeler, subscription, uriPatterns: URI_PATTERNS }),
    /cursor repeated/u
  );
});

test("queryLabels rejects unsafe or unverified service endpoints", async () => {
  for (const serviceEndpoint of [
    "https://labels.example.com/path",
    "https://localhost/",
    "https://localhost./",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://labeler.local/",
    "https://labeler.local./"
  ]) {
    const { transport, urls } = transportWith([{ labels: [] }]);
    const client = createRecommendationAtprotoQueryLabelsClient(transport);
    await assert.rejects(
      client.queryPage({
        subjectId: SUBJECT,
        labeler: { ...labeler, serviceEndpoint },
        subscription,
        uriPatterns: URI_PATTERNS
      }),
      /service endpoint/u
    );
    assert.equal(urls.length, 0);
  }
});
