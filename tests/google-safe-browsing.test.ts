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
