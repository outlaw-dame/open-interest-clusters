import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecommendationFediverseEligibility } from "../src/index.js";
import {
  createFediverseInstancePolicyEvidence,
  fetchFediverseDomainPolicyList,
  fetchMastodonAccountEligibilityEvidence,
  mapMastodonAccountToFediverseEligibilityAccount,
  type RecommendationFediverseDomainPolicyListEvidence
} from "../src/recommendation/fediverse-eligibility-evidence.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

function textFailureResponse(status = 200): Response {
  const response = new Response("unavailable", { status });
  Object.defineProperty(response, "text", {
    value: async () => {
      throw new Error("response body unavailable");
    }
  });
  return response;
}

test("Mastodon account mapper normalizes account evidence for eligibility evaluation", () => {
  const account = mapMastodonAccountToFediverseEligibilityAccount(
    {
      acct: "Alice",
      uri: "https://Example.COM/users/Alice#main",
      discoverable: true,
      indexable: true,
      locked: false,
      bot: false,
      moved: { acct: "alice@new.example" },
      note: "<p>#NoAI #Photography</p>",
      fields: [{ name: "Policy", value: "#Robotxt" }]
    },
    { instanceDomain: " Example.COM ", featuredTags: ["NoScraping"] }
  );

  assert.equal(account.acct, "alice@example.com");
  assert.equal(account.domain, "example.com");
  assert.equal(account.actorUri, "https://example.com/users/Alice");
  assert.equal(account.discoverable, true);
  assert.equal(account.indexable, true);
  assert.equal(account.moved, true);
  assert.deepEqual(account.profileTags, ["NoAI", "NoScraping", "Photography", "Robotxt"]);

  const result = evaluateRecommendationFediverseEligibility({ account });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "excluded.account_opt_out_tag");
});

test("Mastodon account mapper uses returned remote account domain instead of lookup instance domain", () => {
  const account = mapMastodonAccountToFediverseEligibilityAccount(
    {
      acct: "alice@remote.example",
      uri: "https://remote.example/users/alice",
      discoverable: true,
      indexable: true
    },
    { instanceDomain: "lookup.example" }
  );

  assert.equal(account.acct, "alice@remote.example");
  assert.equal(account.domain, "remote.example");
  assert.equal(account.actorUri, "https://remote.example/users/alice");
  assert.equal(evaluateRecommendationFediverseEligibility({ account }).eligible, true);
});

test("Mastodon account mapper rejects internally conflicting identity domains", () => {
  assert.throws(
    () =>
      mapMastodonAccountToFediverseEligibilityAccount(
        {
          acct: "alice@remote.example",
          uri: "https://other.example/users/alice"
        },
        { instanceDomain: "lookup.example" }
      ),
    /Conflicting Mastodon account identity domains/u
  );
});

test("Mastodon account fetch uses lookup endpoint, retries transient failures, and maps JSON", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("accept"), "application/json");
    if (calls.length === 1) return new Response("temporary", { status: 503 });
    return jsonResponse({ acct: "alice", discoverable: true, indexable: true, note: "#Art" });
  };

  const result = await fetchMastodonAccountEligibilityEvidence({
    instanceDomain: "example.com",
    acct: "alice",
    attempts: 2,
    initialDelayMs: 0,
    maxDelayMs: 0,
    fetchImpl
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0], "https://example.com/api/v1/accounts/lookup?acct=alice");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.evidence.account.acct, "alice@example.com");
  assert.equal(result.ok && result.evidence.account.discoverable, true);
});

test("Mastodon account fetch returns invalid_response for malformed JSON without retrying", async () => {
  let calls = 0;
  const result = await fetchMastodonAccountEligibilityEvidence({
    instanceDomain: "example.com",
    acct: "alice",
    attempts: 3,
    initialDelayMs: 0,
    maxDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, reason: "invalid_response", status: 200, stale: false });
});

test("Mastodon account fetch returns invalid_response for structurally invalid account payloads without retrying", async () => {
  let calls = 0;
  const result = await fetchMastodonAccountEligibilityEvidence({
    instanceDomain: "lookup.example",
    acct: "alice@remote.example",
    attempts: 3,
    initialDelayMs: 0,
    maxDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ acct: "alice@remote.example", uri: "https://other.example/users/alice" });
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, reason: "invalid_response", status: 200, stale: false });
});

test("Mastodon account fetch returns privacy-safe failures for missing or failed accounts", async () => {
  const notFound = await fetchMastodonAccountEligibilityEvidence({
    instanceDomain: "example.com",
    acct: "missing",
    attempts: 1,
    fetchImpl: async () => new Response("missing", { status: 404 })
  });
  const failed = await fetchMastodonAccountEligibilityEvidence({
    instanceDomain: "example.com",
    acct: "alice",
    attempts: 1,
    fetchImpl: async () => new Response("rate limited", { status: 429, headers: { "retry-after": "2" } })
  });

  assert.deepEqual(notFound, { ok: false, reason: "not_found", status: 404, stale: false });
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.reason, "http_status");
  assert.equal(!failed.ok && failed.status, 429);
  assert.equal(!failed.ok && failed.retryAfterMs, 2000);
});

test("domain policy list fetch normalizes lists, supports etags, and ignores malformed entries", async () => {
  const result = await fetchFediverseDomainPolicyList({
    source: { provider: "oliphant", tier: "tier0", url: "https://lists.example/tier0.txt" },
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("accept")?.startsWith("text/plain"), true);
      return new Response("Example.COM\n# comment\nsocial.example.com, bad://entry\n", {
        status: 200,
        headers: { etag: "abc" }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.evidence.domains, ["example.com", "social.example.com"]);
  assert.equal(result.ok && result.evidence.ignoredEntryCount, 1);
  assert.equal(result.ok && result.evidence.etag, "abc");
  assert.equal(result.ok && result.evidence.stale, false);
});

test("domain policy list fetch returns invalid_response for unreadable successful responses without retrying", async () => {
  let calls = 0;
  const result = await fetchFediverseDomainPolicyList({
    source: { provider: "custom", url: "https://lists.example/custom.txt" },
    allowStaleOnError: false,
    attempts: 3,
    initialDelayMs: 0,
    maxDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return textFailureResponse();
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, reason: "invalid_response", status: 200, stale: false });
});

test("domain policy list fetch uses cached domains for 304 and stale fallback", async () => {
  const cache = { etag: "abc", domains: ["example.com"], fetchedAt: "2026-05-23T00:00:00.000Z" };
  const notModified = await fetchFediverseDomainPolicyList({
    source: { provider: "custom", url: "https://lists.example/custom.txt" },
    cache,
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("if-none-match"), "abc");
      return new Response(null, { status: 304 });
    }
  });
  const stale = await fetchFediverseDomainPolicyList({
    source: { provider: "custom", url: "https://lists.example/custom.txt" },
    cache,
    attempts: 1,
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });

  assert.equal(notModified.ok, true);
  assert.equal(notModified.ok && notModified.evidence.notModified, true);
  assert.equal(stale.ok, true);
  assert.equal(stale.ok && stale.evidence.stale, true);
});

test("instance policy evidence composes list evidence for eligibility denial", () => {
  const list: RecommendationFediverseDomainPolicyListEvidence = {
    provider: "oliphant",
    tier: "tier1",
    sourceUrl: "https://lists.example/tier1.txt",
    domains: ["example.com"],
    fetchedAt: "2026-05-23T00:00:00.000Z",
    notModified: false,
    stale: false,
    ignoredEntryCount: 0
  };
  const instance = createFediverseInstancePolicyEvidence({
    domain: "social.example.com",
    policyLists: [list]
  });

  assert.deepEqual(instance.policyMatches, [{ provider: "oliphant", tier: "tier1" }]);
  assert.equal(
    evaluateRecommendationFediverseEligibility({
      account: { acct: "alice@social.example.com", discoverable: true, indexable: true },
      instance
    }).reason,
    "excluded.instance_policy.oliphant_tier1"
  );
});
