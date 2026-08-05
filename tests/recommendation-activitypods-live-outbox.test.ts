import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITYPODS_READ_OUTBOX_RIGHT,
  createRecommendationActivityPodsPublicOutboxSourceAdapter,
  normalizeRecommendationActivityPodsActorBinding,
  normalizeRecommendationActivityPodsOutboxGrant,
  watchRecommendationActivityPodsOutbox,
  type RecommendationActivityPodsOutboxGrantInput,
  type RecommendationActivityPodsOutboxNotificationTransportRequest,
  type RecommendationActivityPodsResourceTransportRequest
} from "../src/index.js";

const NOW = "2026-08-05T02:30:00.000Z";
const LATER = "2026-08-05T03:30:00.000Z";
const WEB_ID = "https://pod.example/alice";
const INBOX = `${WEB_ID}/inbox`;
const OUTBOX = `${WEB_ID}/outbox`;
const APP = "https://recommend.example/actors/app";
const REGISTRATION = `${WEB_ID}/data/application-registrations/1`;
const ACCESS_GRANT = `${WEB_ID}/data/access-grants/1`;
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function actorDocument(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@id": WEB_ID,
    type: ["Person", "foaf:Person"],
    inbox: INBOX,
    outbox: { type: "Link", id: `${WEB_ID}/links/outbox`, href: OUTBOX },
    publicKey: { owner: WEB_ID, publicKeyPem: "public-key" },
    endpoints: {
      proxyUrl: `${WEB_ID}/proxy`,
      "void:sparqlEndpoint": `${WEB_ID}/sparql`
    },
    ...extra
  };
}

function grant(overrides: Partial<RecommendationActivityPodsOutboxGrantInput> = {}): RecommendationActivityPodsOutboxGrantInput {
  return {
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    applicationRegistrationUri: REGISTRATION,
    accessGrantUri: ACCESS_GRANT,
    specialRights: ["apods:ReadOutbox"],
    grantedAt: NOW,
    checkedAt: NOW,
    expiresAt: LATER,
    ...overrides
  };
}

function publicAuthorization(subjectId: string) {
  return {
    status: "authorized" as const,
    subjectId,
    checkedAt: NOW,
    sourceVisibility: "public" as const,
    accessBasis: "public_web" as const,
    containsPrivateData: false
  };
}

function publicActivity(id: string): Record<string, unknown> {
  return {
    id,
    type: "Create",
    actor: WEB_ID,
    to: [PUBLIC],
    published: NOW,
    object: {
      id: `${id}/object`,
      type: "Note",
      attributedTo: WEB_ID,
      to: [PUBLIC],
      content: "Public ActivityPods post"
    }
  };
}

async function* frames(values: readonly unknown[]): AsyncIterable<unknown> {
  for (const value of values) yield value;
}

test("binds an ActivityPods actor, WebID, boxes, public key, proxy, and SPARQL endpoint", () => {
  const binding = normalizeRecommendationActivityPodsActorBinding(actorDocument(), WEB_ID);
  assert.deepEqual(binding, {
    webId: WEB_ID,
    inboxUri: INBOX,
    outboxUri: OUTBOX,
    proxyUri: `${WEB_ID}/proxy`,
    sparqlEndpointUri: `${WEB_ID}/sparql`
  });

  assert.throws(
    () => normalizeRecommendationActivityPodsActorBinding(
      actorDocument({ publicKey: { owner: "https://pod.example/mallory" } }),
      WEB_ID
    ),
    /public-key owner mismatch/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsActorBinding(
      actorDocument({ outbox: "https://other.example/alice/outbox" }),
      WEB_ID
    ),
    /actor outbox/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsActorBinding(actorDocument(), "https://localhost/alice"),
    /WebID/u
  );
});

test("public ActivityPods outbox reads stay anonymous and produce ActivityPods source context", async () => {
  const requests: RecommendationActivityPodsResourceTransportRequest[] = [];
  const adapter = createRecommendationActivityPodsPublicOutboxSourceAdapter({
    webId: WEB_ID,
    authorize: (request) => publicAuthorization(request.subjectId),
    transport: {
      get(request) {
        requests.push(request);
        if (request.url === WEB_ID) return { observedAt: NOW, body: actorDocument() };
        return {
          observedAt: NOW,
          body: {
            id: OUTBOX,
            type: "OrderedCollection",
            orderedItems: [publicActivity(`${WEB_ID}/activities/1`)]
          }
        };
      }
    }
  });

  const result = await adapter.read({ subjectId: "viewer", limit: 1 });
  assert.equal(adapter.protocol, "activitypods");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.authentication === "anonymous"));
  assert.ok(requests.every((request) => request.jsonLdContext === "https://www.w3.org/ns/activitystreams"));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.context.protocol, "activitypods");
  assert.equal(result.items[0]?.context.sourceVisibility, "public");
  assert.equal(result.items[0]?.context.containsPrivateData, false);
});

test("outbox grants require active Pod-bound apods:ReadOutbox authorization", () => {
  const normalized = normalizeRecommendationActivityPodsOutboxGrant(grant());
  assert.deepEqual(normalized.specialRights, [ACTIVITYPODS_READ_OUTBOX_RIGHT]);

  assert.throws(
    () => normalizeRecommendationActivityPodsOutboxGrant(grant({ specialRights: ["apods:ReadInbox"] })),
    /ReadOutbox/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsOutboxGrant(grant({ revokedAt: NOW })),
    /revoked/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsOutboxGrant(grant({ expiresAt: NOW })),
    /expired/u
  );
  assert.throws(
    () => normalizeRecommendationActivityPodsOutboxGrant(
      grant({ accessGrantUri: "https://other.example/grants/1" })
    ),
    /access grant URI/u
  );
});

test("normalizes live Add, Remove, Update, and Delete notifications without exposing state", async () => {
  const subscriptions: RecommendationActivityPodsOutboxNotificationTransportRequest[] = [];
  const delivered: string[] = [];
  const result = await watchRecommendationActivityPodsOutbox({
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    actorDocument: actorDocument(),
    authorize: () => grant(),
    transport: {
      subscribe(request) {
        subscriptions.push(request);
        return frames([
          {
            observedAt: NOW,
            body: {
              id: `${WEB_ID}/notifications/1`,
              type: "Add",
              object: `${WEB_ID}/activities/1`,
              target: OUTBOX,
              state: { content: "must not escape" }
            }
          },
          {
            observedAt: NOW,
            body: {
              id: `${WEB_ID}/notifications/2`,
              type: "Remove",
              object: `${WEB_ID}/activities/1`,
              target: OUTBOX
            }
          },
          {
            observedAt: NOW,
            body: { id: `${WEB_ID}/notifications/3`, type: "Update", object: OUTBOX }
          },
          {
            observedAt: NOW,
            body: { id: `${WEB_ID}/notifications/4`, type: "Delete", topic: OUTBOX }
          }
        ]);
      }
    },
    onMutation(mutation) {
      delivered.push(mutation.action);
    }
  });

  assert.deepEqual(subscriptions, [{
    topic: OUTBOX,
    applicationActorUri: APP,
    accessGrantUri: ACCESS_GRANT,
    authentication: "application",
    jsonLdContext: "https://www.w3.org/ns/solid/notifications-context/v1"
  }]);
  assert.deepEqual(delivered, [
    "public_refetch_required",
    "retract",
    "invalidate_snapshot",
    "disable_source"
  ]);
  assert.equal(result.frames, 4);
  assert.equal(result.mutations.length, 4);
  assert.equal("state" in result.mutations[0]!, false);
  assert.equal("content" in result.mutations[0]!, false);
  assert.equal(result.mutations[0]?.resourceUri, `${WEB_ID}/activities/1`);
});

test("reauthorizes before every frame and stops before emitting after revocation", async () => {
  let authorizations = 0;
  let emitted = 0;
  await assert.rejects(
    watchRecommendationActivityPodsOutbox({
      subjectId: "viewer",
      webId: WEB_ID,
      applicationActorUri: APP,
      actorDocument: actorDocument(),
      authorize() {
        authorizations += 1;
        return authorizations >= 3 ? grant({ revokedAt: NOW }) : grant();
      },
      transport: {
        subscribe: () => frames([
          { observedAt: NOW, body: { type: "Add", object: `${WEB_ID}/activities/1`, target: OUTBOX } },
          { observedAt: NOW, body: { type: "Add", object: `${WEB_ID}/activities/2`, target: OUTBOX } }
        ])
      },
      onMutation() {
        emitted += 1;
      }
    }),
    /revoked/u
  );
  assert.equal(emitted, 1);
  assert.equal(authorizations, 3);
});

test("rejects notification origin and topic confusion", async () => {
  for (const body of [
    { type: "Add", object: "https://other.example/activity/1", target: OUTBOX },
    { type: "Add", object: `${WEB_ID}/activities/1`, target: `${WEB_ID}/inbox` },
    { type: "Update", object: `${WEB_ID}/inbox` }
  ]) {
    await assert.rejects(
      watchRecommendationActivityPodsOutbox({
        subjectId: "viewer",
        webId: WEB_ID,
        applicationActorUri: APP,
        actorDocument: actorDocument(),
        authorize: () => grant(),
        transport: { subscribe: () => frames([{ observedAt: NOW, body }]) }
      }),
      /notification|outbox/u
    );
  }
});

test("deduplicates notification IDs and enforces bounded stream processing", async () => {
  const duplicate = {
    observedAt: NOW,
    body: {
      id: `${WEB_ID}/notifications/repeated`,
      type: "Add",
      object: `${WEB_ID}/activities/1`,
      target: OUTBOX
    }
  };
  const result = await watchRecommendationActivityPodsOutbox({
    subjectId: "viewer",
    webId: WEB_ID,
    applicationActorUri: APP,
    actorDocument: actorDocument(),
    authorize: () => grant(),
    maxFrames: 2,
    transport: {
      subscribe: () => frames([
        duplicate,
        duplicate,
        {
          observedAt: NOW,
          body: { type: "Add", object: `${WEB_ID}/activities/2`, target: OUTBOX }
        }
      ])
    }
  });
  assert.equal(result.frames, 2);
  assert.equal(result.mutations.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.truncated, true);
});
