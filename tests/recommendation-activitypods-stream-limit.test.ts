import assert from "node:assert/strict";
import test from "node:test";

import { watchRecommendationActivityPodsOutbox } from "../src/index.js";

const NOW = "2026-08-05T02:45:00.000Z";
const WEB_ID = "https://pod.example/alice";
const OUTBOX = `${WEB_ID}/outbox`;
const APP = "https://recommend.example/actors/app";

function actorDocument(): Record<string, unknown> {
  return {
    id: WEB_ID,
    type: "Person",
    inbox: `${WEB_ID}/inbox`,
    outbox: OUTBOX,
    publicKey: { owner: WEB_ID }
  };
}

function grant() {
  return {
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    applicationRegistrationUri: `${WEB_ID}/data/application-registrations/1`,
    accessGrantUri: `${WEB_ID}/data/access-grants/1`,
    specialRights: ["apods:ReadOutbox"],
    grantedAt: NOW,
    checkedAt: NOW,
    expiresAt: "2026-08-05T03:45:00.000Z"
  } as const;
}

test("returns immediately when maxFrames is reached without awaiting an extra notification", async () => {
  let nextCalls = 0;
  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<unknown>> {
          nextCalls += 1;
          if (nextCalls <= 2) {
            return {
              done: false,
              value: {
                observedAt: NOW,
                body: {
                  id: `${WEB_ID}/notifications/${nextCalls}`,
                  type: "Add",
                  object: `${WEB_ID}/activities/${nextCalls}`,
                  target: OUTBOX
                }
              }
            };
          }
          throw new Error("watcher requested an extra notification after reaching maxFrames");
        }
      };
    }
  };

  const result = await watchRecommendationActivityPodsOutbox({
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    actorDocument: actorDocument(),
    authorize: grant,
    maxFrames: 2,
    transport: { subscribe: () => stream }
  });

  assert.equal(nextCalls, 2);
  assert.equal(result.frames, 2);
  assert.equal(result.mutations.length, 2);
  assert.equal(result.truncated, true);
});

test("returns immediately when maxMutations is reached without awaiting another notification", async () => {
  let nextCalls = 0;
  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<unknown>> {
          nextCalls += 1;
          if (nextCalls === 1) {
            return {
              done: false,
              value: {
                observedAt: NOW,
                body: {
                  type: "Add",
                  object: `${WEB_ID}/activities/1`,
                  target: OUTBOX
                }
              }
            };
          }
          throw new Error("watcher requested an extra notification after reaching maxMutations");
        }
      };
    }
  };

  const result = await watchRecommendationActivityPodsOutbox({
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    actorDocument: actorDocument(),
    authorize: grant,
    maxMutations: 1,
    transport: { subscribe: () => stream }
  });

  assert.equal(nextCalls, 1);
  assert.equal(result.mutations.length, 1);
  assert.equal(result.truncated, true);
});
