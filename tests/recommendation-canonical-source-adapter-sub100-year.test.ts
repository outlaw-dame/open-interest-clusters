import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalRecommendationSourceAdapter,
  readRecommendationSourceAdapter,
  type CanonicalRecommendationEvent
} from "../src/index.js";

const archivalEvent: CanonicalRecommendationEvent = {
  canonicalIntentId: "archival-0099",
  kind: "PostCreate",
  sourceProtocol: "activitypub",
  sourceEventId: "https://archive.example/activities/0099",
  visibility: "public",
  createdAt: "0099-01-01T00:00:00Z",
  observedAt: "0099-01-01T00:00:00Z"
};

test("canonical adapter preserves sub-100 RFC3339 years during since comparisons", async () => {
  const adapter = createCanonicalRecommendationSourceAdapter({
    events: [archivalEvent]
  });

  const before = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "0098-12-31T23:59:59Z"
  });
  assert.deepEqual(
    before.items.map((item) => item.provenance.opaqueSourceId),
    ["archival-0099"]
  );

  const after = await readRecommendationSourceAdapter(adapter, {
    subjectId: "subject-1",
    since: "0100-01-01T00:00:00Z"
  });
  assert.deepEqual(after.items, []);
});
