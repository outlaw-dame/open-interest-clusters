import test from "node:test";
import assert from "node:assert/strict";

import { executeWithRetry } from "../src/utils/retry-policy.js";

test("executeWithRetry retries and eventually succeeds", async () => {
  let attempts = 0;

  const result = await executeWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary");
    return "ok";
  }, {
    attempts: 4,
    initialDelayMs: 1,
    maxDelayMs: 2,
    retrySleeper: async () => undefined
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("executeWithRetry honors retry classification", async () => {
  let attempts = 0;

  await assert.rejects(async () => executeWithRetry(async () => {
    attempts += 1;
    throw new Error("permanent");
  }, {
    attempts: 5,
    initialDelayMs: 1,
    maxDelayMs: 2,
    shouldRetry: ({ error }) => (error instanceof Error ? error.message !== "permanent" : true),
    retrySleeper: async () => undefined
  }));

  assert.equal(attempts, 1);
});

test("executeWithRetry emits retry events with bounded delay", async () => {
  const scheduledDelays: number[] = [];
  let attempts = 0;

  await executeWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("temporary");
    return "done";
  }, {
    attempts: 3,
    initialDelayMs: 10,
    maxDelayMs: 15,
    random: () => 1,
    jitterRatio: 0.2,
    onRetry: (event) => {
      scheduledDelays.push(event.delayMs);
    },
    retrySleeper: async () => undefined
  });

  assert.equal(attempts, 3);
  assert.equal(scheduledDelays.length, 2);
  const firstDelay = scheduledDelays[0];
  const secondDelay = scheduledDelays[1];
  if (firstDelay === undefined || secondDelay === undefined) {
    assert.fail("Expected two scheduled retry delays.");
  }

  assert.equal(firstDelay <= 15, true);
  assert.equal(secondDelay <= 15, true);
});

test("executeWithRetry does not schedule retries beyond max elapsed budget", async () => {
  let attempts = 0;
  let scheduledRetries = 0;
  let slept = false;

  await assert.rejects(
    () =>
      executeWithRetry(async () => {
        attempts += 1;
        throw new Error("temporary");
      }, {
        attempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 10,
        maxElapsedMs: 5,
        jitterRatio: 0,
        onRetry: () => {
          scheduledRetries += 1;
        },
        retrySleeper: async () => {
          slept = true;
        }
      }),
    /temporary/u
  );

  assert.equal(attempts, 1);
  assert.equal(scheduledRetries, 0);
  assert.equal(slept, false);
});
