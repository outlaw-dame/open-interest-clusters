import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalRecommendationSourceItem,
  type CanonicalRecommendationEvent
} from "../src/index.js";

const baseEvent: CanonicalRecommendationEvent = {
  canonicalIntentId: "canonical-text-whitespace",
  kind: "PostCreate",
  sourceProtocol: "activitypub",
  sourceEventId: "https://remote.example/activities/text-whitespace",
  visibility: "public",
  createdAt: "2026-05-16T00:00:00Z",
  observedAt: "2026-05-16T00:00:01Z"
};

test("canonical source item accepts safe whitespace in text content fields", () => {
  const item = createCanonicalRecommendationSourceItem({
    ...baseEvent,
    content: {
      title: "First line\nSecond line",
      summary: "One\tTwo",
      plaintext: "Paragraph one\r\nParagraph two"
    }
  });

  assert.notEqual(item, null);
  assert.equal(item?.provenance.opaqueSourceId, "canonical-text-whitespace");
});

test("canonical source item rejects unsafe control characters in text content fields", () => {
  assert.throws(
    () =>
      createCanonicalRecommendationSourceItem({
        ...baseEvent,
        canonicalIntentId: "canonical-unsafe-control",
        sourceEventId: "https://remote.example/activities/unsafe-control",
        content: {
          summary: `safe${String.fromCharCode(1)}unsafe`
        }
      }),
    TypeError
  );
  assert.throws(
    () =>
      createCanonicalRecommendationSourceItem({
        ...baseEvent,
        canonicalIntentId: "canonical-unsafe-c1-control",
        sourceEventId: "https://remote.example/activities/unsafe-c1-control",
        content: {
          summary: `safe${String.fromCharCode(0x80)}unsafe`
        }
      }),
    TypeError
  );
});
