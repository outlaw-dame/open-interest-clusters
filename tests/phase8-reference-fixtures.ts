// Shared setup for the Phase 8 reference tests. Not a test file: `pnpm test` only runs `*.test.js`.
import type { RecommendationCuratedAccountSet } from "../src/index.js";
import {
  REFERENCE_PROVIDER_ID,
  REFERENCE_SUBJECT_ID,
  createFakeAccountCandidate,
  createFakeAccountResolver,
  createFakeCandidateSource,
  createFakeProviderDescriptor,
  createFakeProviderService,
  createReferenceClock
} from "../examples/fakes.js";
import { createReferenceOnboarding, type ReferenceOnboardingOptions } from "../examples/onboarding-flow.js";

export const T0 = "2026-10-01T10:00:00.000Z";
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function collection(id: string, members: readonly (string | [string, "accepted" | "pending" | "rejected" | "revoked" | "unknown"])[], overrides: Partial<RecommendationCuratedAccountSet> = {}): RecommendationCuratedAccountSet {
  return {
    provider: "mastodon_collection",
    id,
    url: `https://${REFERENCE_PROVIDER_ID}/collections/${id}`,
    curatorId: "curator-1",
    name: `Collection ${id}`,
    discoverable: true,
    sensitive: false,
    observedAt: T0,
    hashtags: ["gaming"],
    trustBoundary: "same_provider",
    membershipComplete: true,
    members: members.map((entry) => {
      const [name, state] = typeof entry === "string" ? [entry, "accepted" as const] : entry;
      return { accountId: `acct-${name}`, accountUri: `https://${REFERENCE_PROVIDER_ID}/users/${name}`, handle: `${name}@${REFERENCE_PROVIDER_ID}`, state };
    }),
    ...overrides
  };
}

export function setup(options: { curatedSets?: readonly RecommendationCuratedAccountSet[]; directory?: boolean; providerTtlMs?: number; extra?: Partial<ReferenceOnboardingOptions> } = {}) {
  const clock = createReferenceClock(T0);
  const provider = createFakeProviderService();
  const resolver = createFakeAccountResolver(clock);
  const directory = createFakeCandidateSource("fake.directory", options.directory === false ? [] : [
    createFakeAccountCandidate("dana", T0, ["gaming"]),
    createFakeAccountCandidate("erin", T0, ["technology"]),
    createFakeAccountCandidate("frank", T0, ["gaming"], { verified: false })
  ]);
  const onboarding = createReferenceOnboarding({
    subjectId: REFERENCE_SUBJECT_ID,
    clock,
    provider,
    resolver,
    sources: [directory],
    curatedSets: options.curatedSets ?? [],
    describeProvider: () => createFakeProviderDescriptor(new Date(Date.parse(T0) - HOUR_MS).toISOString(), new Date(Date.parse(T0) + (options.providerTtlMs ?? 7 * DAY_MS)).toISOString()),
    ...options.extra
  });
  return { clock, provider, resolver, directory, onboarding };
}
