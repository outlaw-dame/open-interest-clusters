import assert from "node:assert/strict";
import test from "node:test";

import { createRecommendationActivityPubPublicOutboxSourceAdapter } from "../src/index.js";

const NOW = "2026-08-05T02:10:00.000Z";
const ACTOR = "https://social.example/users/alice";
const OUTBOX = "https://social.example/users/alice/outbox";
const LINK_NODE = "https://social.example/links/first-page";
const FIRST_PAGE = `${OUTBOX}?page=1`;
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function authorization(subjectId: string) {
  return {
    status: "authorized" as const,
    subjectId,
    checkedAt: NOW,
    sourceVisibility: "public" as const,
    accessBasis: "public_web" as const,
    containsPrivateData: false
  };
}

test("ActivityStreams Link objects prefer href over the link node id", async () => {
  const requested: string[] = [];
  const adapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: ACTOR,
    authorize: (request) => authorization(request.subjectId),
    transport: {
      get({ url }) {
        requested.push(url);
        if (url === ACTOR) {
          return { observedAt: NOW, body: { id: ACTOR, type: "Person", outbox: OUTBOX } };
        }
        if (url === OUTBOX) {
          return {
            observedAt: NOW,
            body: {
              id: OUTBOX,
              type: "OrderedCollection",
              first: { type: "Link", id: LINK_NODE, href: FIRST_PAGE }
            }
          };
        }
        if (url === FIRST_PAGE) {
          return {
            observedAt: NOW,
            body: {
              id: FIRST_PAGE,
              type: "OrderedCollectionPage",
              partOf: { type: "Link", id: "https://social.example/links/outbox", href: OUTBOX },
              orderedItems: [
                {
                  id: "https://social.example/activities/1",
                  type: "Create",
                  actor: ACTOR,
                  to: [PUBLIC],
                  published: NOW,
                  object: {
                    id: "https://social.example/objects/1",
                    type: "Note",
                    attributedTo: ACTOR,
                    to: [PUBLIC],
                    content: "Public ActivityPods-compatible post"
                  }
                }
              ]
            }
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    }
  });

  const result = await adapter.read({ subjectId: "viewer", limit: 1 });
  assert.deepEqual(requested, [ACTOR, OUTBOX, FIRST_PAGE]);
  assert.equal(result.items.length, 1);
});
