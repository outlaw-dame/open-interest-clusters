import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationActivityPodsLiveSourceAdapter,
  type RecommendationActivityPodsLiveTransportRequest
} from "../src/recommendation/activitypods-live-source-adapter.js";

const NOW = "2026-08-05T02:00:00Z";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const OUTBOX = "https://pod.example/alice/outbox";
const INBOX = "https://pod.example/alice/inbox";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function grant(boxType: "inbox" | "outbox", subjectId = "subject-1") {
  return {
    subjectId,
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    boxType,
    boxUri: boxType === "outbox" ? OUTBOX : INBOX,
    rights: [boxType === "outbox" ? "apods:ReadOutbox" : "apods:ReadInbox"] as const,
    checkedAt: NOW,
    providerPolicyAllowsProcessing: true
  };
}

function activity(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "Create",
    actor: OWNER,
    to: [PUBLIC],
    published: NOW,
    object: {
      id: `${id}/object`,
      type: "Note",
      attributedTo: OWNER,
      content: "Public ActivityPods content",
      to: [PUBLIC]
    },
    ...extra
  };
}

function notification(
  id: string,
  dereferencedActivity: unknown,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    type: "Add",
    boxType: "outbox",
    actorUri: OWNER,
    targetUri: OUTBOX,
    objectUri: `${id}/object`,
    dereferencedActivity,
    observedAt: NOW,
    ...extra
  };
}

test("validates the ActivityPods grant before reading notifications", async () => {
  let calls = 0;
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: () => ({ ...grant("outbox"), rights: ["apods:ReadInbox"] }),
    transport: {
      read() {
        calls += 1;
        return { notifications: [] };
      }
    }
  });

  await assert.rejects(adapter.read({ subjectId: "subject-1" }), /lacks apods:ReadOutbox/u);
  assert.equal(calls, 0);
});

test("emits only explicitly public owner-outbox activities as ActivityPods source items", async () => {
  const requests: RecommendationActivityPodsLiveTransportRequest[] = [];
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    transport: {
      read(request) {
        requests.push(request);
        return {
          notifications: [
            notification("https://pod.example/notifications/1", activity("https://pod.example/activities/1"))
          ],
          cursor: "cursor-1"
        };
      }
    }
  });

  const result = await adapter.read({ subjectId: "subject-1", limit: 10 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.ownerActorUri, OWNER);
  assert.equal(requests[0]?.boxUri, OUTBOX);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.context.protocol, "activitypods");
  assert.equal(result.items[0]?.context.sourceVisibility, "public");
  assert.equal(result.items[0]?.context.accessBasis, "solid_acl_read");
  assert.equal(result.items[0]?.context.containsPrivateData, false);
  assert.equal(result.items[0]?.context.serverSideProcessing, true);
  assert.equal(result.items[0]?.provenance.trustBoundary, "user_owned");
  assert.equal(result.cursor, "cursor-1");
});

test("keeps private, blind-recipient, and application-control traffic out of interest sources", async () => {
  const ignored: string[] = [];
  const privateActivity = activity("https://pod.example/activities/private", {
    to: ["https://pod.example/bob"],
    object: {
      id: "https://pod.example/objects/private",
      type: "Note",
      attributedTo: OWNER,
      content: "Private",
      to: ["https://pod.example/bob"]
    }
  });
  const blindActivity = activity("https://pod.example/activities/blind", {
    bto: ["https://pod.example/bob"]
  });
  const registrationActivity = activity("https://pod.example/activities/registration", {
    object: {
      id: "https://pod.example/registrations/1",
      type: "apods:ApplicationRegistration",
      to: [PUBLIC]
    }
  });
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    onIgnored: (event) => ignored.push(event.reason),
    transport: {
      read: () => ({
        notifications: [
          notification("https://pod.example/notifications/private", privateActivity),
          notification("https://pod.example/notifications/blind", blindActivity),
          notification("https://pod.example/notifications/registration", registrationActivity)
        ]
      })
    }
  });

  const result = await adapter.readChanges({ subjectId: "subject-1" });
  assert.equal(result.items.length, 0);
  assert.equal(result.ignoredCount, 3);
  assert.deepEqual(ignored.sort(), ["control_activity", "not_explicitly_public", "not_explicitly_public"]);
});

test("inbox subscriptions are available for controlled workflows but never emit positive interests", async () => {
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "inbox",
    boxUri: INBOX,
    authorize: (request) => grant("inbox", request.subjectId),
    transport: {
      read: () => ({
        notifications: [{
          ...notification("https://pod.example/notifications/inbox", activity("https://remote.example/activities/1")),
          boxType: "inbox",
          actorUri: OWNER,
          targetUri: INBOX
        }]
      })
    }
  });

  const result = await adapter.readChanges({ subjectId: "subject-1" });
  assert.equal(result.items.length, 0);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.retractions.length, 0);
});

test("surfaces bounded Remove and Delete retractions without synthesizing positive source items", async () => {
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    transport: {
      read: () => ({
        notifications: [
          {
            id: "https://pod.example/notifications/remove",
            type: "Remove",
            boxType: "outbox",
            actorUri: OWNER,
            targetUri: OUTBOX,
            objectUri: "https://pod.example/activities/removed",
            observedAt: NOW
          },
          {
            id: "https://pod.example/notifications/delete",
            type: "Delete",
            boxType: "outbox",
            actorUri: OWNER,
            targetUri: OUTBOX,
            objectUri: "https://pod.example/activities/deleted",
            observedAt: NOW
          }
        ]
      })
    }
  });

  const result = await adapter.readChanges({ subjectId: "subject-1" });
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.retractions.map((event) => event.reason), [
    "collection_item_removed",
    "resource_deleted"
  ]);
  assert.ok(Object.isFrozen(result.retractions));
});

test("deduplicates notification IDs within a batch", async () => {
  const duplicate = notification(
    "https://pod.example/notifications/duplicate",
    activity("https://pod.example/activities/duplicate")
  );
  const adapter = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    transport: { read: () => ({ notifications: [duplicate, duplicate] }) }
  });
  const result = await adapter.read({ subjectId: "subject-1" });
  assert.equal(result.items.length, 1);
});

test("fails closed on notification owner, target, activity actor, and cursor mismatches", async () => {
  for (const changed of [
    { actorUri: "https://pod.example/mallory" },
    { targetUri: "https://pod.example/alice/inbox" }
  ]) {
    const adapter = createRecommendationActivityPodsLiveSourceAdapter({
      ownerActorUri: OWNER,
      ownerWebId: OWNER,
      applicationActorUri: APP,
      boxType: "outbox",
      boxUri: OUTBOX,
      authorize: (request) => grant("outbox", request.subjectId),
      transport: {
        read: () => ({
          notifications: [notification(
            "https://pod.example/notifications/mismatch",
            activity("https://pod.example/activities/mismatch"),
            changed
          )]
        })
      }
    });
    await assert.rejects(adapter.read({ subjectId: "subject-1" }), /binding mismatch/u);
  }

  const actorMismatch = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    transport: {
      read: () => ({
        notifications: [notification(
          "https://pod.example/notifications/actor-mismatch",
          activity("https://pod.example/activities/actor-mismatch", {
            actor: "https://pod.example/mallory"
          })
        )]
      })
    }
  });
  await assert.rejects(actorMismatch.read({ subjectId: "subject-1" }), /activity actor mismatch/u);

  const invalidCursor = createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: (request) => grant("outbox", request.subjectId),
    transport: { read: () => ({ notifications: [], cursor: "x".repeat(1_025) }) }
  });
  await assert.rejects(invalidCursor.read({ subjectId: "subject-1" }), /cursor/u);
});
