import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationMastodonAccountFeaturedTagsClient,
  createRecommendationMastodonTrendingTagsClient
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

function publicAuthorization(subjectId: string) {
  return {
    status: "authorized",
    subjectId,
    checkedAt: NOW,
    sourceVisibility: "public",
    accessBasis: "public_web"
  } as const;
}

test("account featured hashtags are strong public curator signals", async () => {
  const requests: unknown[] = [];
  const client = createRecommendationMastodonAccountFeaturedTagsClient({
    baseUrl: "https://social.example",
    accountId: "42",
    transport: {
      get(input) {
        requests.push(input);
        return {
          observedAt: NOW,
          body: [{
            id: "7",
            name: "OpenSource",
            url: "https://social.example/@alice/tagged/OpenSource",
            statuses_count: "23",
            last_status_at: "2026-07-30T10:00:00.000Z"
          }]
        };
      }
    }
  });
  const evidence = await client.read({ subjectId: "viewer", authorization: publicAuthorization("viewer") });
  assert.equal(evidence[0]?.kind, "account_featured");
  assert.equal(evidence[0]?.tag, "opensource");
  assert.equal(evidence[0]?.confidence, 0.95);
  assert.equal(evidence[0]?.statusesCount, 23);
  assert.match(String((requests[0] as { url: string }).url), /accounts\/42\/featured_tags/u);
  assert.equal((requests[0] as { requiresAuthentication: boolean }).requiresAuthentication, false);
});

test("private or non-public authorization is rejected before transport", async () => {
  let calls = 0;
  const client = createRecommendationMastodonTrendingTagsClient({
    baseUrl: "https://social.example",
    transport: { get: () => { calls += 1; return { observedAt: NOW, body: [] }; } }
  });

  for (const authorization of [
    {
      ...publicAuthorization("viewer"),
      sourceVisibility: "followers_only" as const,
      accessBasis: "oauth_scope" as const,
      containsPrivateData: true
    },
    {
      ...publicAuthorization("viewer"),
      containsPrivateData: true
    }
  ]) {
    await assert.rejects(
      client.read({ subjectId: "viewer", authorization }),
      /explicitly public source data/u
    );
  }
  assert.equal(calls, 0);
});

test("trending tags are weak contextual signals with bounded valid history", async () => {
  const client = createRecommendationMastodonTrendingTagsClient({
    baseUrl: "https://social.example",
    transport: {
      get: () => ({
        observedAt: NOW,
        body: [{
          id: "10",
          name: "Fediverse",
          history: [
            { day: "1785628800", uses: "20", accounts: "12" },
            { day: "1785542400", uses: "15", accounts: "9" }
          ]
        }]
      })
    }
  });
  const evidence = await client.read({ subjectId: "viewer", authorization: publicAuthorization("viewer") });
  assert.equal(evidence[0]?.kind, "instance_trending");
  assert.equal(evidence[0]?.confidence, 0.35);
  assert.equal(evidence[0]?.historyUses, 35);
  assert.equal(evidence[0]?.historyAccounts, 21);
});

test("configured limits and invalid history buckets fail closed", async () => {
  const oversized = createRecommendationMastodonTrendingTagsClient({
    baseUrl: "https://social.example",
    limit: 1,
    transport: { get: () => ({ observedAt: NOW, body: [{ name: "one" }, { name: "two" }] }) }
  });
  await assert.rejects(
    oversized.read({ subjectId: "viewer", authorization: publicAuthorization("viewer") }),
    /response/u
  );

  for (const history of [
    [{ uses: "1", accounts: "1" }],
    [{ day: "1785628800", uses: "1", accounts: "1" }, { day: "1785628800", uses: "1", accounts: "1" }],
    [{ day: "1785715200", uses: "1", accounts: "1" }],
    [{ day: "1785628801", uses: "1", accounts: "1" }]
  ]) {
    const client = createRecommendationMastodonTrendingTagsClient({
      baseUrl: "https://social.example",
      transport: { get: () => ({ observedAt: NOW, body: [{ name: "fediverse", history }] }) }
    });
    await assert.rejects(
      client.read({ subjectId: "viewer", authorization: publicAuthorization("viewer") }),
      /history/u
    );
  }
});

test("invalid authorization enums and numeric-only tags fail closed", async () => {
  let calls = 0;
  const client = createRecommendationMastodonTrendingTagsClient({
    baseUrl: "https://social.example",
    transport: { get: () => { calls += 1; return { observedAt: NOW, body: [{ name: "123" }] }; } }
  });
  await assert.rejects(
    client.read({
      subjectId: "viewer",
      authorization: { ...publicAuthorization("viewer"), sourceVisibility: "invented" as never }
    }),
    /authorization/u
  );
  assert.equal(calls, 0);
  await assert.rejects(
    client.read({ subjectId: "viewer", authorization: publicAuthorization("viewer") }),
    /hashtag name/u
  );
});
