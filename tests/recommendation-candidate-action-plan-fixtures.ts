import { createRecommendationCuratedAccountSetSourceId, type RecommendationCandidate, type RecommendationCandidateKind, type RecommendationProviderCapability, type RecommendationProviderDescriptor, type RecommendationProtocol, type RecommendationStarterPackMemberInput } from "../src/index.js";

export const MEMBER_SET = { setProvider: "mastodon_collection", setId: "collection-1" } as const;
export const MEMBER_OBSERVED_AT = "2026-09-26T06:00:00.000Z";
const MEMBER_EVALUATED_AT = "2026-09-26T06:01:00.000Z";

/** Builds a starter-pack member whose candidate carries curated-set provenance matching its accepted consent. */
export function starterPackMember(account: RecommendationCandidate, accountId: string): RecommendationStarterPackMemberInput {
  const candidate: RecommendationCandidate = { ...account, provenance: [{ kind: "curated_account_set", sourceId: createRecommendationCuratedAccountSetSourceId(MEMBER_SET.setProvider, MEMBER_SET.setId), sourceItemId: accountId, observedAt: MEMBER_OBSERVED_AT, trustBoundary: "same_provider" }] };
  return {
    eligibility: { candidate, eligible: true, reasonCodes: ["eligible"], evaluatedAt: MEMBER_EVALUATED_AT, resolvedAccount: { id: accountId, uri: candidate.nativeId } },
    consent: { state: "accepted", ...MEMBER_SET, observedAt: MEMBER_OBSERVED_AT }
  };
}

const CAPABILITY_BY_KIND: Readonly<Partial<Record<RecommendationCandidateKind, RecommendationProviderCapability>>> = {
  account: "follows", feed: "feeds", list: "lists", starter_pack: "starter_packs", labeler: "labels", community: "communities", hashtag: "hashtags"
};

export function actionProvider(kind: RecommendationCandidateKind, protocol: RecommendationProtocol = "activitypub"): RecommendationProviderDescriptor {
  const capability = CAPABILITY_BY_KIND[kind];
  return {
    providerId: "example.test",
    detectedAt: "2026-09-26T05:59:00.000Z",
    expiresAt: "2026-09-26T07:00:00.000Z",
    protocolBindings: [{ protocol, authority: "protocol_native", verification: "verified" }],
    applicationProfiles: [],
    capabilities: capability === undefined ? [] : [{ capability, state: "supported", authority: "protocol_native", protocol }]
  };
}
