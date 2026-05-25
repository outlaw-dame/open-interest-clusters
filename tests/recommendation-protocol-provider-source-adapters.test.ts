import test from "node:test";
import assert from "node:assert/strict";

import {
  createAtprotoProviderRecordSourceAdapter,
  createMastodonProviderStatusSourceAdapter,
  readRecommendationSourceAdapter,
  readRecommendationSourceAdapterWithConsent,
  type RecommendationConsentPolicy
} from "../src/index.js";

const privateRankingPolicy: RecommendationConsentPolicy = {
  subjectId: "reader-1",
  allowedDataUses: ["ranking"],
  privateDataUses: ["ranking"],
  thirdPartyPrivateDataUses: ["ranking"]
};

const publicRankingPolicy: RecommendationConsentPolicy = {
  subjectId: "reader-1",
  allowedDataUses: ["ranking"]
};

test("Mastodon provider record source adapter maps raw statuses through authorization and consent", async () => {
  const adapter = createMastodonProviderStatusSourceAdapter({
    id: "mastodon-raw-test",
    sourceSystem: "mastodon.raw.statuses.v1",
    recordDefaults: {
      trustBoundary: "same_provider",
      containsThirdPartyData: true,
      providerPolicyAllowsProcessing: true
    },
    read: (request) => ({
      records: [
        {
          observedAt: "2026-05-24T01:00:02.000Z",
          containsThirdPartyData: false,
          rawStatus: {
            uri: "https://social.example/users/alice/statuses/1",
            url: "https://social.example/@alice/1",
            created_at: "2026-05-24T01:00:00.000Z",
            visibility: "private",
            content: "<p>private recommendation signal</p>",
            account: {
              acct: "alice@social.example",
              uri: "https://social.example/users/alice"
            }
          }
        }
      ],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-24T01:00:03.000Z",
        sourceVisibility: "followers_only",
        accessBasis: "follower_relationship",
        containsPrivateData: true,
        containsThirdPartyData: false,
        providerPolicyAllowsProcessing: true
      },
      cursor: "next-page"
    })
  });

  const result = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1" },
    dataUse: "ranking",
    policy: privateRankingPolicy
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, "next-page");
  assert.equal(result.items[0]?.kind, "post");
  assert.equal(result.items[0]?.context.protocol, "activitypub");
  assert.equal(result.items[0]?.context.sourceVisibility, "followers_only");
  assert.equal(result.items[0]?.context.accessBasis, "follower_relationship");
  assert.equal(result.items[0]?.context.containsPrivateData, true);
  assert.equal(result.items[0]?.context.containsThirdPartyData, true);
  assert.equal(result.items[0]?.context.providerPolicyAllowsProcessing, true);
  assert.equal(result.items[0]?.provenance.adapterId, "mastodon-raw-test");
  assert.equal(result.items[0]?.provenance.sourceSystem, "mastodon.raw.statuses.v1");
  assert.equal(result.items[0]?.provenance.trustBoundary, "same_provider");
  assert.equal(result.consentEvaluations[0]?.decision, "allow");
});

test("provider record source defaults fail closed when provider policy denies processing", async () => {
  const adapter = createMastodonProviderStatusSourceAdapter({
    recordDefaults: {
      providerPolicyAllowsProcessing: false
    },
    read: (request) => ({
      records: [
        {
          observedAt: "2026-05-24T01:10:02.000Z",
          providerPolicyAllowsProcessing: true,
          rawStatus: {
            uri: "https://social.example/users/alice/statuses/2",
            created_at: "2026-05-24T01:10:00.000Z",
            visibility: "public",
            content: "<p>provider policy should deny</p>",
            account: {
              acct: "alice@social.example",
              uri: "https://social.example/users/alice"
            }
          }
        }
      ],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-24T01:10:03.000Z",
        sourceVisibility: "public",
        accessBasis: "public_web",
        providerPolicyAllowsProcessing: true
      }
    })
  });

  const readResult = await readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" });
  assert.equal(readResult.items[0]?.context.providerPolicyAllowsProcessing, false);

  await assert.rejects(
    () =>
      readRecommendationSourceAdapterWithConsent({
        adapter,
        readRequest: { subjectId: "reader-1" },
        dataUse: "ranking",
        policy: publicRankingPolicy
      }),
    /policy\.deny\.provider_policy/u
  );
});

test("ATProto provider record source adapter maps raw records", async () => {
  const adapter = createAtprotoProviderRecordSourceAdapter({
    id: "atproto-raw-test",
    sourceSystem: "atproto.raw.records.v1",
    read: (request) => ({
      records: [
        {
          operation: "create",
          repositoryDid: "did:plc:alice123",
          collection: "app.bsky.feed.post",
          rkey: "post1",
          observedAt: "2026-05-24T01:20:02.000Z",
          record: {
            text: "public repo recommendation signal",
            createdAt: "2026-05-24T01:20:00.000Z"
          }
        }
      ],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-24T01:20:03.000Z",
        sourceVisibility: "atproto_public_repo",
        accessBasis: "atproto_public_repo"
      }
    })
  });

  const result = await readRecommendationSourceAdapterWithConsent({
    adapter,
    readRequest: { subjectId: "reader-1" },
    dataUse: "ranking",
    policy: publicRankingPolicy
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "post");
  assert.equal(result.items[0]?.context.protocol, "atproto");
  assert.equal(result.items[0]?.context.sourceVisibility, "atproto_public_repo");
  assert.equal(result.items[0]?.provenance.adapterId, "atproto-raw-test");
  assert.equal(result.items[0]?.provenance.sourceSystem, "atproto.raw.records.v1");
});

test("provider record source adapters treat null optional defaults and cursor as absent", async () => {
  const adapter = createMastodonProviderStatusSourceAdapter({
    recordDefaults: {
      projectionMode: null,
      trustBoundary: null,
      containsThirdPartyData: null,
      serverSideProcessing: null,
      providerPolicyAllowsProcessing: null
    } as unknown as never,
    read: (request) => ({
      records: [
        {
          observedAt: "2026-05-24T02:00:02.000Z",
          rawStatus: {
            uri: "https://social.example/users/alice/statuses/3",
            created_at: "2026-05-24T02:00:00.000Z",
            visibility: "public",
            content: "<p>null optional values should be tolerated</p>",
            account: {
              acct: "alice@social.example",
              uri: "https://social.example/users/alice"
            }
          }
        }
      ],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-24T02:00:03.000Z",
        sourceVisibility: "public",
        accessBasis: "public_web"
      },
      cursor: null as unknown as string
    })
  });

  const result = await readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" });
  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, undefined);
});

test("provider record source adapters reject read results containing non-object records", async () => {
  const adapter = createAtprotoProviderRecordSourceAdapter({
    read: (request) => ({
      records: [null, 1] as unknown as never[],
      authorization: {
        status: "authorized",
        subjectId: request.subjectId,
        checkedAt: "2026-05-24T02:10:03.000Z",
        sourceVisibility: "atproto_public_repo",
        accessBasis: "atproto_public_repo"
      }
    })
  });

  await assert.rejects(
    () => readRecommendationSourceAdapter(adapter, { subjectId: "reader-1" }),
    /read result/u
  );
});
