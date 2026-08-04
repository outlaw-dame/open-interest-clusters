import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendationMastodonBlocksClient,
  createRecommendationMastodonDomainBlocksClient,
  createRecommendationMastodonFiltersClient,
  createRecommendationMastodonMutesClient,
  evaluateRecommendationMastodonViewerSafety,
  type RecommendationMastodonViewerSafetySnapshot
} from "../src/index.js";

const authorization = {
  status: "authorized" as const,
  subjectId: "viewer-1",
  checkedAt: "2026-08-03T20:00:00.000Z",
  sourceVisibility: "followers_only" as const,
  accessBasis: "oauth_scope" as const,
  containsPrivateData: true
};

function transport(body: unknown, nextUrl?: string) {
  return {
    async get(input: { url: string; requiresAuthentication: true }) {
      assert.equal(input.requiresAuthentication, true);
      return { body, observedAt: "2026-08-03T20:00:00.000Z", ...(nextUrl === undefined ? {} : { nextUrl }) };
    }
  };
}

test("Mastodon blocks and mutes require their private OAuth scopes", async () => {
  const account = { id: "42", acct: "Alice@Example.Social", url: "https://example.social/@alice" };
  const blocks = createRecommendationMastodonBlocksClient({ baseUrl: "https://mastodon.example", transport: transport([account]) });
  const mutes = createRecommendationMastodonMutesClient({ baseUrl: "https://mastodon.example", transport: transport([account]) });
  const blocked = await blocks.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:blocks"] });
  const muted = await mutes.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:mutes"] });
  assert.deepEqual(blocked.items[0], { id: "42", acct: "alice@example.social", domain: "example.social", url: "https://example.social/@alice" });
  assert.deepEqual(muted.items[0], blocked.items[0]);
  await assert.rejects(blocks.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:mutes"] }), /read:blocks/u);
});

test("Mastodon domain blocks reject cross-origin pagination", async () => {
  const client = createRecommendationMastodonDomainBlocksClient({
    baseUrl: "https://mastodon.example",
    transport: transport(["Blocked.Example"], "https://evil.example/api/v1/domain_blocks?max_id=1")
  });
  await assert.rejects(client.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:blocks"] }), /pagination URL/u);
});

test("Mastodon v2 filters preserve contexts, keywords, statuses, and actions", async () => {
  const client = createRecommendationMastodonFiltersClient({
    baseUrl: "https://mastodon.example",
    transport: transport([{ id: "f1", title: "Spoilers", context: ["home", "public"], expires_at: null, filter_action: "hide", keywords: [{ id: "k1", keyword: "spoiler", whole_word: true }], statuses: [{ id: "s1", status_id: "99" }] }])
  });
  const result = await client.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:filters"] });
  assert.deepEqual(result.items[0], { id: "f1", title: "Spoilers", contexts: ["home", "public"], expiresAt: null, action: "hide", keywords: [{ id: "k1", keyword: "spoiler", wholeWord: true }], statuses: [{ id: "s1", statusId: "99" }] });
});

test("Mastodon viewer safety authorization fails before transport", async () => {
  let called = false;
  const client = createRecommendationMastodonBlocksClient({ baseUrl: "https://mastodon.example", transport: { async get() { called = true; return { body: [], observedAt: "2026-08-03T20:00:00.000Z" }; } } });
  await assert.rejects(client.readPage({ subjectId: "viewer-1", authorization: { ...authorization, containsPrivateData: false }, grantedScopes: ["read:blocks"] }), /private-data authorization/u);
  assert.equal(called, false);
});

const snapshot: RecommendationMastodonViewerSafetySnapshot = {
  subjectId: "viewer-1",
  observedAt: "2026-08-03T20:00:00.000Z",
  blockedAccounts: [{ id: "blocked", acct: "blocked@example.social", domain: "example.social" }],
  mutedAccounts: [{ id: "muted", acct: "muted@example.net", domain: "example.net" }],
  blockedDomains: ["harmful.example"],
  filters: [
    { id: "hide", title: "Hide spoilers", contexts: ["home"], expiresAt: null, action: "hide", keywords: [{ id: "k1", keyword: "spoiler", wholeWord: true }], statuses: [] },
    { id: "blur", title: "Blur gore", contexts: ["home"], expiresAt: null, action: "blur", keywords: [{ id: "k2", keyword: "gore", wholeWord: false }], statuses: [] },
    { id: "warn", title: "Warn politics", contexts: ["home"], expiresAt: null, action: "warn", keywords: [{ id: "k3", keyword: "politics", wholeWord: false }], statuses: [] }
  ]
};

test("Mastodon safety excludes blocked, muted, and domain-blocked candidates", () => {
  assert.equal(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { accountId: "blocked", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible, false);
  assert.equal(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { accountId: "muted", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible, false);
  assert.equal(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { domain: "sub.harmful.example", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible, false);
});

test("Mastodon safety applies hide, blur, and warn without conflating actions", () => {
  assert.deepEqual(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "Major spoiler ahead", context: "home" }, now: "2026-08-03T21:00:00.000Z" }), { eligible: false, mediaEligible: true, warningRequired: false, reasonCodes: ["viewer_filter_hide"], matchedFilterIds: ["hide"] });
  const blurred = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "graphic gore", context: "home", hasMedia: true }, now: "2026-08-03T21:00:00.000Z" });
  assert.equal(blurred.eligible, true); assert.equal(blurred.mediaEligible, false); assert.equal(blurred.warningRequired, true);
  const warned = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "politics today", context: "home" }, now: "2026-08-03T21:00:00.000Z" });
  assert.equal(warned.eligible, true); assert.equal(warned.warningRequired, true);
});

test("Mastodon safety honors whole-word and expiration semantics", () => {
  assert.equal(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "spoilerish", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible, true);
  const expiredSnapshot: RecommendationMastodonViewerSafetySnapshot = { ...snapshot, filters: [{ ...snapshot.filters[0]!, expiresAt: "2026-08-03T19:00:00.000Z" }] };
  assert.equal(evaluateRecommendationMastodonViewerSafety({ snapshot: expiredSnapshot, candidate: { text: "spoiler", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible, true);
});
