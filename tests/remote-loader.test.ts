import test from "node:test";
import assert from "node:assert/strict";
import dataset from "../datasets/interests.global.v1.json" with { type: "json" };
import type { InterestClusterDataset } from "../src/types/schema.js";
import { fetchRemoteDataset } from "../src/loaders/remote-loader.js";

test("fetchRemoteDataset returns cached dataset on 304", async () => {
  const cached = dataset as unknown as Readonly<InterestClusterDataset>;
  const response = await fetchRemoteDataset("https://example.invalid/dataset.json", {
    cache: { etag: '"v1"', dataset: cached },
    fetchImpl: async () => new Response(null, { status: 304, headers: { etag: '"v1"' } })
  });
  assert.equal(response.notModified, true);
  assert.equal(response.dataset.dataset_id, dataset.dataset_id);
});

test("fetchRemoteDataset retries retryable HTTP failures and then succeeds", async () => {
  let attempts = 0;

  const response = await fetchRemoteDataset("https://example.invalid/dataset.json", {
    attempts: 4,
    initialDelayMs: 1,
    maxDelayMs: 2,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("", { status: 503 });
      }

      return new Response(JSON.stringify(dataset), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  });

  assert.equal(response.notModified, false);
  assert.equal(response.dataset.dataset_id, dataset.dataset_id);
  assert.equal(attempts, 3);
});

test("fetchRemoteDataset does not retry dataset validation failures", async () => {
  let attempts = 0;

  await assert.rejects(
    () => fetchRemoteDataset("https://example.invalid/dataset.json", {
      attempts: 4,
      initialDelayMs: 1,
      maxDelayMs: 2,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    })
  );

  assert.equal(attempts, 1);
});
