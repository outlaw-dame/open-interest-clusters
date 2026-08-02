import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRecommendationAccountEligibility,
  filterEligibleLegacyFollowPackMembers,
  normalizeLegacyFollowPackCsv
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

function allowFediverseAccount(profileUrl: string) {
  return {
    account: {
      actorUri: profileUrl,
      discoverable: true,
      indexable: true,
      noindex: false,
      profileTags: [],
      featuredTags: []
    },
    policy: { providerAllowsRecommendation: true },
    viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
  } as const;
}

function oneMemberPack() {
  return normalizeLegacyFollowPackCsv({
    source: "generic_csv",
    sourceUrl: "https://packs.example/accounts.csv",
    name: "Pack",
    observedAt: NOW,
    csv: "account,url\n@candidate@social.example,https://social.example/@candidate"
  });
}

function activeResolver(reference: string) {
  return {
    id: reference,
    uri: reference,
    handle: "candidate@social.example",
    lastActivityAt: "2026-08-01T00:00:00.000Z"
  };
}

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

test("strict RFC3339 timestamps reject normalized calendar dates, timezone-less values, and leap seconds", async () => {
  for (const invalid of ["2026-02-30T00:00:00Z", "2026-08-01T00:00:00", "2016-12-31T23:59:60Z"]) {
    await assert.rejects(
      evaluateRecommendationAccountEligibility({
        reference: "https://social.example/@candidate",
        evaluatedAt: NOW,
        resolver: { resolve: () => ({ id: "1", uri: "https://social.example/@candidate", lastActivityAt: invalid }) }
      }),
      /last activity timestamp/u
    );
  }
  await assert.rejects(
    evaluateRecommendationAccountEligibility({
      reference: "https://social.example/@candidate",
      evaluatedAt: "2016-12-31T23:59:60Z",
      resolver: { resolve: () => ({ id: "1", uri: "https://social.example/@candidate", lastActivityAt: "2016-12-31T23:59:59Z" }) }
    }),
    /evaluation timestamp/u
  );
});

test("legacy CSV packs preserve source metadata and only emit active policy-eligible accounts", async () => {
  const pack = normalizeLegacyFollowPackCsv({
    source: "wptoots_wordpress_community",
    sourceUrl: "https://wp-community-on-mastodon.wptoots.social/",
    name: "WordPress Community on Mastodon",
    curator: "@danielauener@wptoots.social",
    optOutSupported: true,
    observedAt: NOW,
    csv: "\uFEFFaccount,name,url,keywords,language\n@active@social.example,Active,https://social.example/@active,wordpress community,en de\n@stale@social.example,Stale,https://social.example/@stale,wordpress,en\n@optout@social.example,Opt Out,https://social.example/@optout,wordpress,en"
  });
  assert.equal(pack.members.length, 3);
  assert.deepEqual(pack.members[0]?.languages, ["en", "de"]);

  const eligible = await filterEligibleLegacyFollowPackMembers({
    pack,
    evaluatedAt: NOW,
    resolver: {
      resolve(reference) {
        return {
          id: reference,
          uri: reference,
          lastActivityAt: reference.includes("stale") ? "2026-05-01T00:00:00.000Z" : "2026-07-20T00:00:00.000Z"
        };
      }
    },
    resolveFediverseEligibility(member, account) {
      return member.reference.includes("optout")
        ? {
            account: {
              actorUri: account.uri,
              discoverable: true,
              indexable: true,
              noindex: false,
              profileTags: ["NoAI"],
              featuredTags: []
            },
            policy: { providerAllowsRecommendation: true },
            viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
          }
        : allowFediverseAccount(account.uri);
    }
  });
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]?.member.reference, "@active@social.example");
  assert.equal(eligible[0]?.fediverseEligibility.reason, "eligible");
});

test("viewer blocks and provider denial prevent follow-pack recommendations", async () => {
  const pack = normalizeLegacyFollowPackCsv({
    source: "generic_csv",
    sourceUrl: "https://packs.example/accounts.csv",
    name: "Pack",
    observedAt: NOW,
    csv: "account,url\n@blocked@social.example,https://social.example/@blocked\n@denied@social.example,https://social.example/@denied"
  });
  const eligible = await filterEligibleLegacyFollowPackMembers({
    pack,
    evaluatedAt: NOW,
    resolver: { resolve: (reference) => ({ id: reference, uri: reference, lastActivityAt: "2026-08-01T00:00:00.000Z" }) },
    resolveFediverseEligibility(member, account) {
      const evidence = allowFediverseAccount(account.uri);
      return member.reference.includes("blocked")
        ? { ...evidence, viewerControls: { blockedAccounts: [account.uri], mutedAccounts: [], blockedDomains: [] } }
        : { ...evidence, policy: { providerAllowsRecommendation: false } };
    }
  });
  assert.deepEqual(eligible, []);
});

test("empty, incomplete, and identity-mismatched policy evidence fail closed", async () => {
  const pack = oneMemberPack();
  const base = {
    pack,
    evaluatedAt: NOW,
    resolver: { resolve: activeResolver }
  };
  await assert.rejects(
    filterEligibleLegacyFollowPackMembers({ ...base, resolveFediverseEligibility: () => ({}) }),
    /complete Fediverse policy evidence/u
  );
  await assert.rejects(
    filterEligibleLegacyFollowPackMembers({
      ...base,
      resolveFediverseEligibility: (_member, account) => ({
        ...allowFediverseAccount(account.uri),
        account: { ...allowFediverseAccount(account.uri).account, actorUri: "https://other.example/@other" }
      })
    }),
    /does not match the resolved account/u
  );
});

test("every supplied account identity must match the resolved account", async () => {
  const pack = oneMemberPack();
  await assert.rejects(
    filterEligibleLegacyFollowPackMembers({
      pack,
      evaluatedAt: NOW,
      resolver: { resolve: activeResolver },
      resolveFediverseEligibility: () => ({
        account: {
          actorUri: "https://other.social.example/@other",
          acct: "candidate@social.example",
          discoverable: true,
          indexable: true,
          noindex: false,
          profileTags: []
        },
        policy: { providerAllowsRecommendation: true },
        viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
      })
    }),
    /does not match the resolved account/u
  );
});

test("legacy follow packs cannot disable noindex or opt-out tag enforcement", async () => {
  const pack = oneMemberPack();
  for (const policy of [
    { providerAllowsRecommendation: true, respectNoindex: false },
    { providerAllowsRecommendation: true, respectOptOutTags: false }
  ] as const) {
    await assert.rejects(
      filterEligibleLegacyFollowPackMembers({
        pack,
        evaluatedAt: NOW,
        resolver: { resolve: activeResolver },
        resolveFediverseEligibility: (_member, account) => ({
          account: {
            actorUri: account.uri,
            discoverable: true,
            indexable: true,
            noindex: false,
            profileTags: []
          },
          policy,
          viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
        })
      }),
      /cannot disable mandatory opt-out checks/u
    );
  }
});

test("combined Mastodon tag evidence is accepted without a fabricated featuredTags array", async () => {
  const pack = oneMemberPack();
  const eligible = await filterEligibleLegacyFollowPackMembers({
    pack,
    evaluatedAt: NOW,
    resolver: { resolve: activeResolver },
    resolveFediverseEligibility: (_member, account) => ({
      account: {
        actorUri: account.uri,
        acct: account.handle,
        discoverable: true,
        indexable: true,
        noindex: false,
        profileTags: []
      },
      policy: { providerAllowsRecommendation: true },
      viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
    })
  });
  assert.equal(eligible.length, 1);
});

test("localhost subdomains are rejected before profile resolution", () => {
  assert.throws(
    () => normalizeLegacyFollowPackCsv({
      source: "generic_csv",
      sourceUrl: "https://packs.example/accounts.csv",
      name: "Unsafe",
      observedAt: NOW,
      csv: "account,url\n@unsafe@example,https://service.localhost/profile"
    }),
    /member profile URL/u
  );
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
