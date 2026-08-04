import { describe, expect, it } from "vitest";
import {
  createRecommendationMastodonBlocksClient,
  createRecommendationMastodonDomainBlocksClient,
  createRecommendationMastodonFiltersClient,
  createRecommendationMastodonMutesClient,
  evaluateRecommendationMastodonViewerSafety,
  type RecommendationMastodonViewerSafetySnapshot
} from "../src/recommendation/mastodon-viewer-safety.js";

const authorization = {
  status: "authorized" as const,
  subjectId: "viewer-1",
  checkedAt: "2026-08-03T20:00:00.000Z",
  sourceVisibility: "private" as const,
  accessBasis: "oauth_scope" as const,
  containsPrivateData: true
};

function transport(body: unknown, nextUrl?: string) {
  return {
    async get(input: { url: string; requiresAuthentication: true }) {
      expect(input.requiresAuthentication).toBe(true);
      return { body, observedAt: "2026-08-03T20:00:00.000Z", ...(nextUrl === undefined ? {} : { nextUrl }) };
    }
  };
}

describe("Mastodon viewer safety API clients", () => {
  it("loads blocks and mutes only with the required private OAuth scopes", async () => {
    const account = { id: "42", acct: "Alice@Example.Social", url: "https://example.social/@alice" };
    const blocks = createRecommendationMastodonBlocksClient({ baseUrl: "https://mastodon.example", transport: transport([account]) });
    const mutes = createRecommendationMastodonMutesClient({ baseUrl: "https://mastodon.example", transport: transport([account]) });

    await expect(blocks.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:blocks"] })).resolves.toMatchObject({
      items: [{ id: "42", acct: "alice@example.social", domain: "example.social" }]
    });
    await expect(mutes.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:mutes"] })).resolves.toMatchObject({
      items: [{ id: "42", acct: "alice@example.social", domain: "example.social" }]
    });
    await expect(blocks.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:mutes"] })).rejects.toThrow(/read:blocks/u);
  });

  it("loads domain blocks and rejects cross-origin pagination", async () => {
    const client = createRecommendationMastodonDomainBlocksClient({
      baseUrl: "https://mastodon.example",
      transport: transport(["Blocked.Example"], "https://evil.example/api/v1/domain_blocks?max_id=1")
    });
    await expect(client.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:blocks"] })).rejects.toThrow(/pagination URL/u);
  });

  it("normalizes v2 filters and preserves warn, hide, and blur actions", async () => {
    const client = createRecommendationMastodonFiltersClient({
      baseUrl: "https://mastodon.example",
      transport: transport([{
        id: "f1",
        title: "Spoilers",
        context: ["home", "public"],
        expires_at: null,
        filter_action: "hide",
        keywords: [{ id: "k1", keyword: "spoiler", whole_word: true }],
        statuses: [{ id: "s1", status_id: "99" }]
      }])
    });
    await expect(client.readPage({ subjectId: "viewer-1", authorization, grantedScopes: ["read:filters"] })).resolves.toMatchObject({
      items: [{ id: "f1", action: "hide", contexts: ["home", "public"], keywords: [{ wholeWord: true }], statuses: [{ statusId: "99" }] }]
    });
  });

  it("requires explicit private-data authorization before transport", async () => {
    let called = false;
    const client = createRecommendationMastodonBlocksClient({
      baseUrl: "https://mastodon.example",
      transport: { async get() { called = true; return { body: [], observedAt: "2026-08-03T20:00:00.000Z" }; } }
    });
    await expect(client.readPage({
      subjectId: "viewer-1",
      authorization: { ...authorization, containsPrivateData: false },
      grantedScopes: ["read:blocks"]
    })).rejects.toThrow(/private-data authorization/u);
    expect(called).toBe(false);
  });
});

describe("Mastodon viewer safety evaluation", () => {
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

  it("never recommends blocked, muted, or domain-blocked candidates", () => {
    expect(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { accountId: "blocked", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).reasonCodes).toContain("viewer_blocked_account");
    expect(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { accountId: "muted", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).reasonCodes).toContain("viewer_muted_account");
    expect(evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { domain: "sub.harmful.example", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).reasonCodes).toContain("viewer_blocked_domain");
  });

  it("applies hide, blur, and warn filters without converting warnings into hidden content", () => {
    const hidden = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "Major spoiler ahead", context: "home" }, now: "2026-08-03T21:00:00.000Z" });
    expect(hidden).toMatchObject({ eligible: false, warningRequired: false });

    const blurred = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "graphic gore", context: "home", hasMedia: true }, now: "2026-08-03T21:00:00.000Z" });
    expect(blurred).toMatchObject({ eligible: true, mediaEligible: false, warningRequired: true });

    const warned = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "politics today", context: "home" }, now: "2026-08-03T21:00:00.000Z" });
    expect(warned).toMatchObject({ eligible: true, warningRequired: true });
  });

  it("honors whole-word matching and expired filters", () => {
    const wholeWord = evaluateRecommendationMastodonViewerSafety({ snapshot, candidate: { text: "spoilerish", context: "home" }, now: "2026-08-03T21:00:00.000Z" });
    expect(wholeWord.eligible).toBe(true);
    const expiredSnapshot = { ...snapshot, filters: [{ ...snapshot.filters[0]!, expiresAt: "2026-08-03T19:00:00.000Z" }] };
    expect(evaluateRecommendationMastodonViewerSafety({ snapshot: expiredSnapshot, candidate: { text: "spoiler", context: "home" }, now: "2026-08-03T21:00:00.000Z" }).eligible).toBe(true);
  });
});
