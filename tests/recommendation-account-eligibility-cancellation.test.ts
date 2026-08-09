import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRecommendationAccountEligibility } from "../src/recommendation/account-recommendation-eligibility.js";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("account eligibility rejects an already-aborted signal before resolver I/O", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already-cancelled"));
  let reads = 0;

  await assert.rejects(() => evaluateRecommendationAccountEligibility({
    reference: "acct:alice",
    resolver: {
      resolve() {
        reads += 1;
        return undefined;
      }
    },
    evaluatedAt: "2026-08-09T10:00:00Z",
    signal: controller.signal
  }), /already-cancelled/u);

  assert.equal(reads, 0);
});

test("moved-account traversal stops before the next hop when cancellation arrives during a resolver await", async () => {
  const controller = new AbortController();
  const firstHop = deferred<{
    id: string;
    uri: string;
    movedTo: string;
  }>();
  const references: string[] = [];

  const evaluation = evaluateRecommendationAccountEligibility({
    reference: "acct:old",
    resolver: {
      resolve(reference) {
        references.push(reference);
        if (reference === "acct:old") return firstHop.promise;
        return {
          id: "new",
          uri: "https://new.example/@alice",
          lastActivityAt: "2026-08-09T09:00:00Z"
        };
      }
    },
    evaluatedAt: "2026-08-09T10:00:00Z",
    signal: controller.signal
  });

  controller.abort(new Error("cancel-between-hops"));
  firstHop.resolve({
    id: "old",
    uri: "https://old.example/@alice",
    movedTo: "acct:new"
  });

  await assert.rejects(evaluation, /cancel-between-hops/u);
  assert.deepEqual(references, ["acct:old"]);
});

test("moved-account traversal still follows the next hop when not cancelled", async () => {
  const references: string[] = [];
  const result = await evaluateRecommendationAccountEligibility({
    reference: "acct:old",
    resolver: {
      resolve(reference) {
        references.push(reference);
        if (reference === "acct:old") {
          return { id: "old", uri: "https://old.example/@alice", movedTo: "acct:new" };
        }
        return { id: "new", uri: "https://new.example/@alice", lastActivityAt: "2026-08-09T09:00:00Z" };
      }
    },
    evaluatedAt: "2026-08-09T10:00:00Z"
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(references, ["acct:old", "acct:new"]);
});
