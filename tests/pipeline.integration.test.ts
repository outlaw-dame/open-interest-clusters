import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClusterIndex,
  hybridScore,
  matchTextToClusters,
  normalizeActivityPubSignal,
  normalizeATProtoSignal,
  rerankMultiObjective,
  type InterestClusterDataset
} from "../src/index.js";

const dataset: InterestClusterDataset = {
  schema_version: "1",
  dataset_id: "test",
  dataset_version: "1",
  locale_default: "en",
  normalization: {
    unicode_form: "NFKC",
    casefold: true,
    strip_leading_hash_for_storage: true
  },
  clusters: [
    {
      id: "gaming.playstation.ps5",
      status: "active",
      display: {
        label: "PS5",
        category: "Gaming"
      },
      anchor: {
        hashtag: "#PS5",
        follow_by_default_if_interest_selected: true
      },
      follow_behavior: {
        mode: "anchor_plus_related",
        allow_user_opt_in_related_hashtags: true,
        max_auto_follow_hashtags: 10
      },
      taxonomy: {
        primary_subcategories: ["Console Gaming"]
      },
      hashtags: {
        anchor: ["#PS5"],
        aliases: ["#PlayStation5", "#PS5Pro"],
        adjacent: [],
        excluded: ["#NoAI"]
      },
      keywords: {
        high_value: ["playstation 5", "ps5"],
        secondary: ["sony console"],
        negative: []
      },
      privacy: {
        respect_discoverable_false: true,
        respect_indexable_false: true,
        exclude_if_profile_or_posts_contain_opt_out_terms: true,
        opt_out_terms: ["#NoAI"]
      },
      sources: {
        curated_by: "test",
        seed_method: "manual",
        last_reviewed_at: new Date().toISOString()
      }
    }
  ]
};

test("ActivityPub pipeline normalization and ranking", () => {
  const signal = normalizeActivityPubSignal({
    id: "ap-1",
    type: "Create",
    actor: "https://example.com/users/alice",
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: {
      type: "Note",
      content: "Loving the new PS5 update",
      published: "2026-01-01T00:00:00Z",
      tag: [{ name: "#PS5" }]
    }
  });

  const index = buildClusterIndex(dataset);

  const matches = matchTextToClusters(signal.text, signal.hashtags, index);

  assert.equal(matches[0]?.clusterId, "gaming.playstation.ps5");

  const scored = hybridScore({
    deterministic: new Map(matches.map((m) => [m.clusterId, m.score]))
  });

  const reranked = rerankMultiObjective(
    scored.map((item) => ({
      clusterId: item.clusterId,
      score: item.score,
      category: "gaming"
    }))
  );

  assert.equal(reranked[0]?.clusterId, "gaming.playstation.ps5");
});

test("ATProto pipeline normalization and ranking", () => {
  const signal = normalizeATProtoSignal({
    uri: "at://did:plc:test/app.bsky.feed.post/1",
    did: "did:plc:test",
    handle: "alice.test",
    record: {
      text: "PS5 Pro performance is incredible",
      tags: ["PS5Pro"],
      createdAt: "2026-01-01T00:00:00Z"
    }
  });

  const index = buildClusterIndex(dataset);

  const matches = matchTextToClusters(signal.text, signal.hashtags, index);

  assert.equal(matches[0]?.clusterId, "gaming.playstation.ps5");
});
