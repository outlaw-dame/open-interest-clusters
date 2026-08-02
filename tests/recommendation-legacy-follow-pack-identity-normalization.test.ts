import assert from "node:assert/strict";
import test from "node:test";
import {
  filterEligibleLegacyFollowPackMembers,
  normalizeLegacyFollowPackCsv
} from "../src/index.js";

const NOW = "2026-08-02T12:00:00.000Z";

test("follow-pack identity matching canonicalizes Unicode usernames and IDNA domains", async () => {
  const pack = normalizeLegacyFollowPackCsv({
    source: "generic_csv",
    sourceUrl: "https://packs.example/accounts.csv",
    name: "Internationalized handles",
    observedAt: NOW,
    csv: "account,url\n@usér@xn--bcher-kva.example,https://xn--bcher-kva.example/@user"
  });

  const eligible = await filterEligibleLegacyFollowPackMembers({
    pack,
    evaluatedAt: NOW,
    resolver: {
      resolve(reference) {
        return {
          id: reference,
          uri: "https://xn--bcher-kva.example/@user",
          handle: "use\u0301r@bücher.example",
          lastActivityAt: "2026-08-01T00:00:00.000Z"
        };
      }
    },
    resolveFediverseEligibility(_member, account) {
      return {
        account: {
          actorUri: account.uri,
          acct: "usér@xn--bcher-kva.example",
          discoverable: true,
          indexable: true,
          noindex: false,
          profileTags: []
        },
        policy: { providerAllowsRecommendation: true },
        viewerControls: { blockedAccounts: [], mutedAccounts: [], blockedDomains: [] }
      };
    }
  });

  assert.equal(eligible.length, 1);
});
