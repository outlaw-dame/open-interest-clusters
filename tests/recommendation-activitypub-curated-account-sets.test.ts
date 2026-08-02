import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationLoopsStarterKitClient,
  createRecommendationMastodonCollectionClient,
  createRecommendationPixelfedStarterKitClient,
  type RecommendationCuratedAccountSetTransportRequest
} from "../src/recommendation/activitypub-curated-account-sets.js";

const SUBJECT = "subject-1";
const OBSERVED_AT = "2026-08-02T13:00:00Z";

function publicAuthorization() {
  return {
    status: "authorized" as const,
    subjectId: SUBJECT,
    checkedAt: OBSERVED_AT,
    sourceVisibility: "public" as const,
    accessBasis: "public_web" as const
  };
}

function privateAuthorization() {
  return {
    status: "authorized" as const,
    subjectId: SUBJECT,
    checkedAt: OBSERVED_AT,
    sourceVisibility: "unknown" as const,
    accessBasis: "oauth_scope" as const,
    containsPrivateData: true
  };
}

test("Mastodon Collections normalize accepted account recommendations and preserve item states", async () => {
  const requests: RecommendationCuratedAccountSetTransportRequest[] = [];
  const client = createRecommendationMastodonCollectionClient({
    baseUrl: "https://social.example",
    collectionId: "123",
    authenticated: true,
    transport: {
      get(request) {
        requests.push(request);
        return {
          observedAt: OBSERVED_AT,
          body: {
            collection: {
              id: "123",
              account_id: "owner",
              url: "https://social.example/collections/123",
              name: "Good accounts",
              description: "Curated recommendations",
              discoverable: true,
              sensitive: false,
              updated_at: "2026-08-02T12:59:00Z",
              tag: { name: "news" },
              items: [
                { account_id: "a1", state: "accepted" },
                { account_id: "a2", state: "pending" }
              ]
            },
            accounts: [
              { id: "owner", url: "https://social.example/@owner", acct: "owner" },
              { id: "a1", url: "https://remote.example/@one", acct: "one@remote.example" },
              { id: "a2", url: "https://social.example/@two", acct: "two" }
            ]
          }
        };
      }
    }
  });

  const result = await client.read({ subjectId: SUBJECT, authorization: privateAuthorization() });
  assert.equal(requests[0]?.requiresAuthentication, true);
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/api/v1/collections/123");
  assert.equal(result.provider, "mastodon_collection");
  assert.equal(result.members.length, 2);
  assert.equal(result.members[0]?.state, "accepted");
  assert.equal(result.members[1]?.state, "pending");
  assert.deepEqual(result.hashtags, ["news"]);
});

test("private curated-set reads reject insufficient authorization before transport", async () => {
  let calls = 0;
  const client = createRecommendationMastodonCollectionClient({
    baseUrl: "https://social.example",
    collectionId: "123",
    authenticated: true,
    transport: {
      get() {
        calls += 1;
        return { body: {}, observedAt: OBSERVED_AT };
      }
    }
  });
  await assert.rejects(
    client.read({ subjectId: SUBJECT, authorization: publicAuthorization() }),
    /authenticated authorization/u
  );
  assert.equal(calls, 0);
});

test("Loops starter kits normalize public metadata and embedded approved accounts", async () => {
  const client = createRecommendationLoopsStarterKitClient({
    baseUrl: "https://loops.example",
    starterKitId: "kit-1",
    transport: {
      get() {
        return {
          observedAt: OBSERVED_AT,
          body: {
            data: {
              id: "kit-1",
              title: "Video creators",
              description: "Accounts to follow",
              url: "https://loops.example/starter-kits/kit-1",
              is_discoverable: true,
              is_sensitive: false,
              updated_at: "2026-08-02T12:59:00Z",
              creator: { id: "creator-1", username: "curator" },
              hashtags: ["video", "art"],
              accounts: [
                { id: "account-1", url: "https://loops.example/@one", username: "one", status: "approved" }
              ]
            }
          }
        };
      }
    }
  });
  const result = await client.read({ subjectId: SUBJECT, authorization: publicAuthorization() });
  assert.equal(result.provider, "loops_starter_kit");
  assert.equal(result.members[0]?.state, "accepted");
  assert.equal(result.membershipComplete, true);
});

test("Pixelfed Starter Kit ActivityPub documents extract only explicit follow actions", async () => {
  const client = createRecommendationPixelfedStarterKitClient({
    documentUrl: "https://pixelfed.example/starter-kits/photo.json",
    transport: {
      get() {
        return {
          observedAt: OBSERVED_AT,
          body: {
            id: "https://pixelfed.example/starter-kits/photo",
            url: "https://pixelfed.example/starter-kits/photo",
            name: "Photography starter",
            attributedTo: {
              id: "https://pixelfed.example/users/curator",
              url: "https://pixelfed.example/@curator"
            },
            actions: [
              { type: "Follow", target: { id: "https://remote.example/users/a", url: "https://remote.example/@a", handle: "a@remote.example" } },
              { type: "Block", target: { id: "https://spam.example/users/s" } }
            ]
          }
        };
      }
    }
  });
  const result = await client.read({ subjectId: SUBJECT, authorization: publicAuthorization() });
  assert.equal(result.provider, "pixelfed_starter_kit");
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0]?.handle, "a@remote.example");
});

test("unsafe provider and document URLs fail before transport", () => {
  const transport = { get: () => ({ body: {}, observedAt: OBSERVED_AT }) };
  assert.throws(
    () => createRecommendationLoopsStarterKitClient({ baseUrl: "https://localhost", starterKitId: "1", transport }),
    /base URL/u
  );
  assert.throws(
    () => createRecommendationPixelfedStarterKitClient({ documentUrl: "http://pixelfed.example/kit", transport }),
    /document URL/u
  );
});
