import assert from "node:assert/strict";
import test from "node:test";
import type { RecommendationActivityPodsBoxGrantEvidenceInput } from "../src/recommendation/activitypods-authorization.js";
import { createRecommendationActivityPodsLiveSourceAdapter } from "../src/recommendation/activitypods-live-source-adapter.js";

const NOW = "2026-08-05T02:00:00Z";
const OWNER = "https://pod.example/alice";
const APP = "https://app.example/application";
const OUTBOX = "https://pod.example/alice/outbox";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function grant(): RecommendationActivityPodsBoxGrantEvidenceInput {
  return {
    subjectId: "subject-1",
    applicationActorUri: APP,
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    boxType: "outbox",
    boxUri: OUTBOX,
    rights: ["apods:ReadOutbox"],
    checkedAt: NOW,
    providerPolicyAllowsProcessing: true
  };
}

function adapterFor(activity: Record<string, unknown>) {
  return createRecommendationActivityPodsLiveSourceAdapter({
    ownerActorUri: OWNER,
    ownerWebId: OWNER,
    applicationActorUri: APP,
    boxType: "outbox",
    boxUri: OUTBOX,
    authorize: grant,
    transport: {
      read: () => ({
        notifications: [{
          id: "https://pod.example/notifications/jsonld-types",
          type: "Add",
          boxType: "outbox",
          actorUri: OWNER,
          targetUri: OUTBOX,
          objectUri: "https://pod.example/activities/jsonld-types",
          dereferencedActivity: activity,
          observedAt: NOW
        }]
      })
    }
  });
}

test("normalizes array-valued JSON-LD activity and object types before ActivityPub mapping", async () => {
  const adapter = adapterFor({
    id: "https://pod.example/activities/jsonld-types",
    type: ["https://example.org/CustomActivity", "Create"],
    actor: OWNER,
    to: [PUBLIC],
    published: NOW,
    object: {
      id: "https://pod.example/objects/jsonld-types",
      type: ["https://example.org/CustomObject", "Note"],
      attributedTo: OWNER,
      content: "Array-valued JSON-LD types",
      to: [PUBLIC]
    }
  });

  const result = await adapter.readChanges({ subjectId: "subject-1" });
  assert.equal(result.items.length, 1);
  assert.equal(result.ignoredCount, 0);
  assert.match(result.items[0]?.provenance.opaqueSourceId ?? "", /jsonld-types/u);
});

test("ignores arrays with no mapper-compatible ActivityStreams type instead of failing the batch", async () => {
  const adapter = adapterFor({
    id: "https://pod.example/activities/unsupported",
    type: ["https://example.org/CustomActivity"],
    actor: OWNER,
    to: [PUBLIC],
    published: NOW,
    object: {
      id: "https://pod.example/objects/unsupported",
      type: ["https://example.org/CustomObject"],
      attributedTo: OWNER,
      content: "Unsupported JSON-LD types",
      to: [PUBLIC]
    }
  });

  const result = await adapter.readChanges({ subjectId: "subject-1" });
  assert.equal(result.items.length, 0);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.retractions.length, 0);
});
