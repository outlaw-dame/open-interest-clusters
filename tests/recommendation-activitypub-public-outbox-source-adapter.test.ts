import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationActivityPubPublicOutboxSourceAdapter,
  type RecommendationActivityPubOutboxTransportRequest
} from "../src/index.js";

const NOW = "2026-08-05T01:00:00.000Z";
const ACTOR = "https://social.example/users/alice";
const OUTBOX = "https://social.example/users/alice/outbox";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function publicAuthorization(subjectId = "viewer") {
  return {
    status: "authorized",
    subjectId,
    checkedAt: NOW,
    sourceVisibility: "public",
    accessBasis: "public_web",
    containsPrivateData: false
  } as const;
}

function createActivity(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "Create",
    actor: ACTOR,
    to: [PUBLIC],
    published: NOW,
    object: {
      id: `${id}/object`,
      type: "Note",
      attributedTo: ACTOR,
      content: "A public ActivityPub note",
      to: [PUBLIC]
    },
    ...extra
  };
}

test("reads a public actor outbox through the generic ActivityPub mapper", async () => {
  const requests: RecommendationActivityPubOutboxTransportRequest[] = [];
  const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    transport: {
      get(request) {
        requests.push(request);
        if (request.url === ACTOR) return { observedAt: NOW, body: { id: ACTOR, type: "Person", outbox: OUTBOX } };
        return {
          observedAt: NOW,
          body: {
            id: OUTBOX,
            type: "OrderedCollection",
            orderedItems: [createActivity("https://social.example/activities/1")]
          }
        };
      }
    },
    authorize: (request) => publicAuthorization(request.subjectId)
  });

  const result = await adapter.read({ subjectId: "viewer", limit: 10 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, ACTOR);
  assert.equal(requests[1]?.url, OUTBOX);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.protocol, "activitypub");
  assert.equal(result.items[0]?.sourceVisibility, "public");
  assert.equal(result.items[0]?.actorUri, ACTOR);
});

test("authorization is validated before transport and private evidence fails closed", async () => {
  let calls = 0;
  const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    transport: { get: () => { calls += 1; return { observedAt: NOW, body: {} }; } },
    authorize: () => ({
      ...publicAuthorization(),
      sourceVisibility: "followers_only",
      accessBasis: "oauth_scope",
      containsPrivateData: true
    })
  });
  await assert.rejects(adapter.read({ subjectId: "viewer" }), /public-read authorization/u);
  assert.equal(calls, 0);
});

test("skips non-public activities without turning them into recommendation records", async () => {
  const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    transport: {
      get: ({ url }) => url === ACTOR
        ? { observedAt: NOW, body: { id: ACTOR, type: "Person", outbox: OUTBOX } }
        : {
            observedAt: NOW,
            body: {
              id: OUTBOX,
              type: "OrderedCollection",
              orderedItems: [
                createActivity("https://social.example/activities/private", {
                  to: ["https://social.example/users/bob"],
                  object: {
                    id: "https://social.example/objects/private",
                    type: "Note",
                    attributedTo: ACTOR,
                    content: "private",
                    to: ["https://social.example/users/bob"]
                  }
                }),
                createActivity("https://social.example/activities/public")
              ]
            }
          }
    },
    authorize: (request) => publicAuthorization(request.subjectId)
  });
  const result = await adapter.read({ subjectId: "viewer" });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0]?.sourceItemId ?? "", /public/u);
});

test("supports bounded pagination and resumes within a page without replaying emitted records", async () => {
  const page2 = `${OUTBOX}?page=2`;
  const activities = [1, 2, 3].map((number) => createActivity(`https://social.example/activities/${number}`));
  const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    maxPagesPerRead: 2,
    transport: {
      get: ({ url }) => {
        if (url === ACTOR) return { observedAt: NOW, body: { id: ACTOR, type: "Person", outbox: OUTBOX } };
        if (url === OUTBOX) return {
          observedAt: NOW,
          body: { id: OUTBOX, type: "OrderedCollectionPage", orderedItems: activities.slice(0, 2), next: page2 }
        };
        return {
          observedAt: NOW,
          body: { id: page2, type: "OrderedCollectionPage", orderedItems: activities.slice(2) }
        };
      }
    },
    authorize: (request) => publicAuthorization(request.subjectId)
  });

  const first = await adapter.read({ subjectId: "viewer", limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.cursor);
  const second = await adapter.read({ subjectId: "viewer", limit: 2, cursor: first.cursor });
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.sourceItemId)).size, 3);
});

test("rejects actor, collection, activity, origin, cycle, and cursor boundary violations", async () => {
  const scenarios: Array<{ name: string; body: Record<string, unknown>; error: RegExp }> = [
    { name: "actor mismatch", body: { id: "https://social.example/users/mallory", outbox: OUTBOX }, error: /identity mismatch/u },
    { name: "cross-origin outbox", body: { id: ACTOR, outbox: "https://evil.example/outbox" }, error: /actor outbox/u }
  ];
  for (const scenario of scenarios) {
    const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
      actorUrl: ACTOR,
      transport: { get: () => ({ observedAt: NOW, body: scenario.body }) },
      authorize: (request) => publicAuthorization(request.subjectId)
    });
    await assert.rejects(adapter.read({ subjectId: "viewer" }), scenario.error, scenario.name);
  }

  const actorMismatch = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    transport: {
      get: ({ url }) => url === ACTOR
        ? { observedAt: NOW, body: { id: ACTOR, outbox: OUTBOX } }
        : { observedAt: NOW, body: { id: OUTBOX, type: "OrderedCollection", orderedItems: [createActivity("https://social.example/a/1", { actor: "https://social.example/users/mallory" })] } }
    },
    authorize: (request) => publicAuthorization(request.subjectId)
  });
  await assert.rejects(actorMismatch.read({ subjectId: "viewer" }), /activity actor mismatch/u);

  const cycle = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    maxPagesPerRead: 3,
    transport: {
      get: ({ url }) => url === ACTOR
        ? { observedAt: NOW, body: { id: ACTOR, outbox: OUTBOX } }
        : { observedAt: NOW, body: { id: OUTBOX, type: "OrderedCollectionPage", orderedItems: [], next: OUTBOX } }
    },
    authorize: (request) => publicAuthorization(request.subjectId)
  });
  await assert.rejects(cycle.read({ subjectId: "viewer" }), /cycle/u);
  await assert.rejects(cycle.read({ subjectId: "viewer", cursor: "https://social.example/not-an-opaque-cursor" }), /cursor/u);
});

test("rejects unsafe endpoints, oversized pages, ambiguous item arrays, and timestamp cursors", async () => {
  assert.throws(
    () => createRecommendationActivityPubPublicOutboxSourceAdapter({
      actorUrl: "https://localhost/users/alice",
      transport: { get: () => ({ observedAt: NOW, body: {} }) },
      authorize: (request) => publicAuthorization(request.subjectId)
    }),
    /actor URL/u
  );

  for (const body of [
    { id: OUTBOX, type: "OrderedCollection", orderedItems: [createActivity("https://social.example/a/1"), createActivity("https://social.example/a/2")] },
    { id: OUTBOX, type: "OrderedCollection", orderedItems: [], items: [] }
  ]) {
    const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
      actorUrl: ACTOR,
      maxItemsPerPage: 1,
      transport: {
        get: ({ url }) => url === ACTOR
          ? { observedAt: NOW, body: { id: ACTOR, outbox: OUTBOX } }
          : { observedAt: NOW, body }
      },
      authorize: (request) => publicAuthorization(request.subjectId)
    });
    await assert.rejects(adapter.read({ subjectId: "viewer", since: NOW }), /opaque cursors/u);
    await assert.rejects(adapter.read({ subjectId: "viewer" }), /collection items/u);
  }
});
