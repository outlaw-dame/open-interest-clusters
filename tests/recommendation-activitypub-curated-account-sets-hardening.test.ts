import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationMastodonCollectionClient,
  type RecommendationCuratedAccountSetTransport
} from "../src/recommendation/activitypub-curated-account-sets.js";

const SUBJECT = "subject-1";
const OBSERVED_AT = "2026-08-02T13:10:00Z";

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    status: "authorized" as const,
    subjectId: SUBJECT,
    checkedAt: OBSERVED_AT,
    sourceVisibility: "public" as const,
    accessBasis: "public_web" as const,
    ...overrides
  };
}

function client(body: unknown, onGet?: () => void) {
  const transport: RecommendationCuratedAccountSetTransport = {
    get() {
      onGet?.();
      return { body, observedAt: OBSERVED_AT };
    }
  };
  return createRecommendationMastodonCollectionClient({
    baseUrl: "https://social.example",
    collectionId: "123",
    transport
  });
}

function collection(overrides: Record<string, unknown> = {}) {
  return {
    collection: {
      id: "123",
      account_id: "owner",
      url: "https://social.example/collections/123",
      name: "Curated accounts",
      discoverable: true,
      sensitive: false,
      items: [],
      ...overrides
    },
    accounts: [
      { id: "owner", url: "https://social.example/@owner", acct: "owner" },
      { id: "member", url: "https://remote.example/@member", acct: "member@remote.example" }
    ]
  };
}

test("fabricated authorization enum values fail before transport", async () => {
  for (const invalid of [
    authorization({ sourceVisibility: "bogus" }),
    authorization({ accessBasis: "bogus" })
  ]) {
    let calls = 0;
    await assert.rejects(
      client(collection(), () => { calls += 1; }).read({ subjectId: SUBJECT, authorization: invalid as never }),
      /authorization/u
    );
    assert.equal(calls, 0);
  }
});

test("Mastodon accounts without an explicit item state remain unknown", async () => {
  const result = await client(collection()).read({ subjectId: SUBJECT, authorization: authorization() });
  assert.equal(result.members[0]?.state, "unknown");
});

test("omitted Mastodon accounts are marked incomplete instead of authoritative empty", async () => {
  const body = collection();
  delete (body as { accounts?: unknown }).accounts;
  const result = await client(body).read({ subjectId: SUBJECT, authorization: authorization() });
  assert.equal(result.members.length, 0);
  assert.equal(result.membershipComplete, false);
});

test("oversized Mastodon collection item arrays are rejected", async () => {
  const items = Array.from({ length: 151 }, (_, index) => ({ account_id: String(index), state: "accepted" }));
  await assert.rejects(
    client(collection({ items })).read({ subjectId: SUBJECT, authorization: authorization() }),
    /Mastodon collection response/u
  );
});
