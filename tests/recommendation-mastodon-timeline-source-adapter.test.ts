import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationMastodonTimelineSourceAdapter,
  type RecommendationMastodonTimelineTransportRequest
} from "../src/recommendation/mastodon-timeline-source-adapter.js";

const SUBJECT = "subject-1";
const OBSERVED_AT = "2026-08-02T12:30:00Z";

function status(id: string, actorOrigin = "https://social.example"): Record<string, unknown> {
  return {
    id,
    uri: `${actorOrigin}/users/alice/statuses/${id}`,
    url: `${actorOrigin}/@alice/${id}`,
    created_at: "2026-08-02T12:00:00Z",
    visibility: "public",
    content: "<p>ActivityPub timeline post</p>",
    account: {
      id: "account-1",
      username: "alice",
      acct: actorOrigin === "https://social.example" ? "alice" : "alice@remote.example",
      url: `${actorOrigin}/@alice`
    },
    tags: []
  };
}

function publicAuthorization() {
  return {
    status: "authorized" as const,
    subjectId: SUBJECT,
    checkedAt: OBSERVED_AT,
    sourceVisibility: "public" as const,
    accessBasis: "public_web" as const,
    containsThirdPartyData: true,
    serverSideProcessing: true,
    providerPolicyAllowsProcessing: true
  };
}

function privateAuthorization() {
  return {
    status: "authorized" as const,
    subjectId: SUBJECT,
    checkedAt: OBSERVED_AT,
    sourceVisibility: "unknown" as const,
    accessBasis: "oauth_scope" as const,
    containsPrivateData: true,
    containsThirdPartyData: true,
    serverSideProcessing: true,
    providerPolicyAllowsProcessing: true
  };
}

test("public timeline reads without requesting authentication and returns normalized ActivityPub items", async () => {
  const requests: RecommendationMastodonTimelineTransportRequest[] = [];
  const adapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    local: true,
    authorize: publicAuthorization,
    transport: {
      async get(request) {
        requests.push(request);
        return {
          body: [status("1"), status("2", "https://remote.example")],
          observedAt: OBSERVED_AT,
          nextUrl: "https://social.example/api/v1/timelines/public?limit=2&max_id=2&local=true"
        };
      }
    }
  });

  const result = await adapter.read({ subjectId: SUBJECT, limit: 2 });
  const requestUrl = new URL(requests[0]?.url ?? "");
  assert.equal(requests[0]?.requiresAuthentication, false);
  assert.equal(requestUrl.pathname, "/api/v1/timelines/public");
  assert.equal(requestUrl.searchParams.get("limit"), "2");
  assert.equal(requestUrl.searchParams.get("local"), "true");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.context.protocol, "activitypub");
  assert.equal(result.items[0]?.provenance.trustBoundary, "same_provider");
  assert.equal(result.items[1]?.provenance.trustBoundary, "remote_provider");
  assert.equal(result.cursor, "https://social.example/api/v1/timelines/public?limit=2&max_id=2&local=true");
});

test("home timeline requires explicit authenticated private-read evidence before transport", async () => {
  let transportCalls = 0;
  const adapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "home",
    authorize: publicAuthorization,
    transport: {
      get() {
        transportCalls += 1;
        return { body: [], observedAt: OBSERVED_AT };
      }
    }
  });

  await assert.rejects(adapter.read({ subjectId: SUBJECT }), /explicit authenticated authorization evidence/u);
  assert.equal(transportCalls, 0);
});

test("home and list timelines request authenticated transport only after authorization succeeds", async () => {
  for (const configuration of [
    { timeline: "home" as const },
    { timeline: "list" as const, listId: "friends/list" }
  ]) {
    const requests: RecommendationMastodonTimelineTransportRequest[] = [];
    const adapter = createRecommendationMastodonTimelineSourceAdapter({
      baseUrl: "https://social.example",
      ...configuration,
      authorize: privateAuthorization,
      transport: {
        get(request) {
          requests.push(request);
          return { body: [status("1")], observedAt: OBSERVED_AT };
        }
      }
    });

    const result = await adapter.read({ subjectId: SUBJECT, limit: 1 });
    assert.equal(requests[0]?.requiresAuthentication, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.context.containsPrivateData, true);
    if (configuration.timeline === "list") {
      assert.equal(new URL(requests[0]?.url ?? "").pathname, "/api/v1/timelines/list/friends%2Flist");
    }
  }
});

test("timeline cursors are constrained to the configured origin, endpoint, query keys, and limit", async () => {
  const adapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    authorize: publicAuthorization,
    transport: { get: () => ({ body: [], observedAt: OBSERVED_AT }) }
  });

  for (const cursor of [
    "https://evil.example/api/v1/timelines/public?limit=2&max_id=1",
    "https://social.example/api/v1/timelines/home?limit=2&max_id=1",
    "https://social.example/api/v1/timelines/public?limit=2&redirect=https://evil.example",
    "https://social.example/api/v1/timelines/public?limit=3&max_id=1"
  ]) {
    await assert.rejects(adapter.read({ subjectId: SUBJECT, limit: 2, cursor }), /cursor/u);
  }
});

test("unsafe base URLs and invalid timeline-specific options fail before authorization or transport", () => {
  const transport = { get: () => ({ body: [], observedAt: OBSERVED_AT }) };
  for (const baseUrl of [
    "http://social.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://social.example/path"
  ]) {
    assert.throws(
      () => createRecommendationMastodonTimelineSourceAdapter({
        baseUrl,
        timeline: "public",
        authorize: publicAuthorization,
        transport
      }),
      /base URL/u
    );
  }

  assert.throws(
    () => createRecommendationMastodonTimelineSourceAdapter({
      baseUrl: "https://social.example",
      timeline: "home",
      local: true,
      authorize: privateAuthorization,
      transport
    }),
    /only valid for public timelines/u
  );
});

test("transport response bounds are enforced and timestamp since reads fail closed", async () => {
  const adapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    maxStatusesPerRead: 1,
    authorize: publicAuthorization,
    transport: { get: () => ({ body: [status("1"), status("2")], observedAt: OBSERVED_AT }) }
  });

  await assert.rejects(adapter.read({ subjectId: SUBJECT, limit: 1 }), /transport response/u);
  await assert.rejects(
    adapter.read({ subjectId: SUBJECT, since: "2026-08-02T12:00:00Z" }),
    /opaque pagination cursors/u
  );
});

test("malformed private authorization is rejected before authenticated transport", async () => {
  for (const authorization of [
    { ...privateAuthorization(), checkedAt: undefined },
    { ...privateAuthorization(), checkedAt: "not-a-timestamp" },
    { ...privateAuthorization(), sourceVisibility: "secret" },
    { ...privateAuthorization(), containsThirdPartyData: "yes" }
  ]) {
    let transportCalls = 0;
    const adapter = createRecommendationMastodonTimelineSourceAdapter({
      baseUrl: "https://social.example",
      timeline: "home",
      authorize: () => authorization as never,
      transport: {
        get() {
          transportCalls += 1;
          return { body: [], observedAt: OBSERVED_AT };
        }
      }
    });
    await assert.rejects(adapter.read({ subjectId: SUBJECT }), /authorization/u);
    assert.equal(transportCalls, 0);
  }
});

test("configured public timeline filters cannot be dropped, added, or flipped by pagination", async () => {
  const configured = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    local: true,
    authorize: publicAuthorization,
    transport: { get: () => ({ body: [], observedAt: OBSERVED_AT }) }
  });
  for (const cursor of [
    "https://social.example/api/v1/timelines/public?limit=2&max_id=1",
    "https://social.example/api/v1/timelines/public?limit=2&max_id=1&local=false",
    "https://social.example/api/v1/timelines/public?limit=2&max_id=1&local=true&remote=false"
  ]) {
    await assert.rejects(configured.read({ subjectId: SUBJECT, limit: 2, cursor }), /cursor/u);
  }

  const unfiltered = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    authorize: publicAuthorization,
    transport: { get: () => ({ body: [], observedAt: OBSERVED_AT }) }
  });
  await assert.rejects(
    unfiltered.read({
      subjectId: SUBJECT,
      limit: 2,
      cursor: "https://social.example/api/v1/timelines/public?limit=2&max_id=1&remote=true"
    }),
    /cursor/u
  );
});

test("timeline adapters expose only capabilities implemented by their fixed endpoint", () => {
  const transport = { get: () => ({ body: [], observedAt: OBSERVED_AT }) };
  const publicAdapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "public",
    authorize: publicAuthorization,
    transport
  });
  const privateAdapter = createRecommendationMastodonTimelineSourceAdapter({
    baseUrl: "https://social.example",
    timeline: "home",
    authorize: privateAuthorization,
    transport
  });

  assert.deepEqual(publicAdapter.capabilities, ["read_public", "supports_incremental_sync"]);
  assert.deepEqual(privateAdapter.capabilities, ["read_private_with_authorization", "supports_incremental_sync"]);
  assert.equal(publicAdapter.capabilities.includes("supports_deletion_events"), false);
  assert.equal(privateAdapter.capabilities.includes("supports_deletion_events"), false);
});
