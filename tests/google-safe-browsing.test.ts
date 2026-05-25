import test from "node:test";
import assert from "node:assert/strict";

import { GoogleSafeBrowsingClient } from "../src/index.js";

test("safe browsing client rejects empty api key", () => {
  assert.throws(() => {
    new GoogleSafeBrowsingClient({
      apiKey: "   "
    });
  });
});

test("safe browsing client rejects non-https endpoints", () => {
  assert.throws(() => {
    new GoogleSafeBrowsingClient({
      apiKey: "test-key",
      endpoint: "http://example.com"
    });
  });
});

test("safe browsing client sanitizes and deduplicates urls", async () => {
  let capturedBody: unknown;

  const client = new GoogleSafeBrowsingClient({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      capturedBody = init?.body;

      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  await client.checkUrls([
    "https://example.com#fragment",
    "https://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com"
  ]);

  const parsed = JSON.parse(String(capturedBody)) as {
    threatInfo: {
      threatEntries: Array<{ url: string }>;
    };
  };

  assert.deepEqual(parsed.threatInfo.threatEntries, [
    { url: "https://example.com/" }
  ]);
});

test("safe browsing retries retryable HTTP errors before succeeding", async () => {
  let attempts = 0;

  const client = new GoogleSafeBrowsingClient({
    apiKey: "test-key",
    retryAttempts: 4,
    initialRetryDelayMs: 1,
    maxRetryDelayMs: 2,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("", { status: 503 });
      }

      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  const result = await client.checkUrls(["https://example.com"]);

  assert.equal(result.length, 1);
  assert.equal(attempts, 3);
});

test("safe browsing does not retry non-retryable HTTP errors", async () => {
  let attempts = 0;

  const client = new GoogleSafeBrowsingClient({
    apiKey: "test-key",
    retryAttempts: 4,
    initialRetryDelayMs: 1,
    maxRetryDelayMs: 2,
    fetchImpl: async () => {
      attempts += 1;
      return new Response("", { status: 400 });
    }
  });

  await assert.rejects(() => client.checkUrls(["https://example.com"]));
  assert.equal(attempts, 1);
});
