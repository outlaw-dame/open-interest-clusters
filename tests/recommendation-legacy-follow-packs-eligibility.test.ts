import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRecommendationAccountEligibility,
  filterEligibleLegacyFollowPackMembers,
  normalizeLegacyFollowPackCsv
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

test("account eligibility follows moved accounts and applies the 45-day activity window", async () => {
  const profiles = new Map<string, unknown>([
    ["@old@example.social", { id: "1", uri: "https://example.social/@old", movedTo: "https://new.example/@new" }],
    ["https://new.example/@new", { id: "2", uri: "https://new.example/@new", lastActivityAt: "2026-07-01T12:00:00.000Z" }]
  ]);
  const result = await evaluateRecommendationAccountEligibility({
    reference: "@old@example.social",
    evaluatedAt: NOW,
    resolver: { resolve: (reference) => profiles.get(reference) as never }
  });
  assert.equal(result.eligible, true);
  assert.equal(result.resolvedAccount?.uri, "https://new.example/@new");
  assert.deepEqual(result.moveChain, ["https://example.social/@old"]);
});

test("inactive, deactivated, suspended, deleted, and unresolved accounts fail closed", async () => {
  for (const [profile, reason] of [
    [{ id: "1", uri: "https://social.example/@stale", lastActivityAt: "2026-06-01T00:00:00.000Z" }, "inactive"],
    [{ id: "1", uri: "https://social.example/@off", lastActivityAt: "2026-08-01T00:00:00.000Z", deactivated: true }, "deactivated"],
    [{ id: "1", uri: "https://social.example/@suspended", lastActivityAt: "2026-08-01T00:00:00.000Z", suspended: true }, "suspended"],
    [{ id: "1", uri: "https://social.example/@deleted", lastActivityAt: "2026-08-01T00:00:00.000Z", deleted: true }, "deleted"],
    [{ id: "1", uri: "https://social.example/@unknown" }, "unresolved"]
  ] as const) {
    const result = await evaluateRecommendationAccountEligibility({
      reference: "https://social.example/@candidate",
      evaluatedAt: NOW,
      resolver: { resolve: () => profile }
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, reason);
  }
});

test("legacy CSV packs preserve source metadata and only emit eligible resolved accounts", async () => {
  const pack = normalizeLegacyFollowPackCsv({
    source: "wptoots_wordpress_community",
    sourceUrl: "https://wp-community-on-mastodon.wptoots.social/",
    name: "WordPress Community on Mastodon",
    curator: "@danielauener@wptoots.social",
    optOutSupported: true,
    observedAt: NOW,
    csv: "account,name,url,keywords,language\n@active@social.example,Active,https://social.example/@active,wordpress community,en de\n@stale@social.example,Stale,https://social.example/@stale,wordpress,en"
  });
  assert.equal(pack.members.length, 2);
  assert.deepEqual(pack.members[0]?.languages, ["en", "de"]);

  const eligible = await filterEligibleLegacyFollowPackMembers({
    pack,
    evaluatedAt: NOW,
    resolver: {
      resolve(reference) {
        return {
          id: reference,
          uri: reference,
          lastActivityAt: reference.includes("active") ? "2026-07-20T00:00:00.000Z" : "2026-05-01T00:00:00.000Z"
        };
      }
    }
  });
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]?.member.reference, "@active@social.example");
});

test("move loops are rejected", async () => {
  const result = await evaluateRecommendationAccountEligibility({
    reference: "a",
    evaluatedAt: NOW,
    resolver: { resolve: (reference) => ({ id: reference, uri: reference, movedTo: reference === "a" ? "b" : "a" }) }
  });
  assert.equal(result.reason, "move_loop");
  assert.equal(result.eligible, false);
});
