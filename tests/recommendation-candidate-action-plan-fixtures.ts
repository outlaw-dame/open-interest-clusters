import type { RecommendationCandidateKind, RecommendationProviderCapability, RecommendationProviderDescriptor, RecommendationProtocol } from "../src/index.js";

const CAPABILITY_BY_KIND: Readonly<Partial<Record<RecommendationCandidateKind, RecommendationProviderCapability>>> = {
  account: "follows", feed: "feeds", list: "lists", starter_pack: "starter_packs", labeler: "labels", community: "collections", hashtag: "hashtags"
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
