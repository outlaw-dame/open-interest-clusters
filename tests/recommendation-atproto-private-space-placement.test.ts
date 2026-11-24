import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RECOMMENDATION_PREFERENCE_STORAGE_TARGETS,
  createRecommendationCatalogIndex,
  createRecommendationOnboardingProfileSeed,
  createRecommendationOnboardingSelection,
  evaluateRecommendationPublicSignalPolicy,
  normalizeRecommendationInterestSignal,
  type RecommendationInterestSignalInput
} from "../src/index.js";

const OBSERVED_AT = "2026-12-02T10:00:00.000Z";
const SUBJECT_ID = "did:plc:exampleuser";

function spaceSignal(overrides: Partial<RecommendationInterestSignalInput> = {}): RecommendationInterestSignalInput {
  return {
    target: { kind: "canonical_interest", key: "technology" },
    action: "select",
    polarity: "positive",
    strength: 1,
    confidence: 1,
    dataUse: "local_personalization",
    privacyBoundary: "server_allowed",
    evidence: {
      sourceItemKind: "collection",
      protocol: "atproto",
      sourceVisibility: "atproto_private_space",
      accessBasis: "atproto_space_authority",
      trustBoundary: "user_owned",
      observedAt: OBSERVED_AT
    },
    consent: {
      decision: "allow",
      reason: "consent.allow.explicit",
      dataUse: "local_personalization",
      protocol: "atproto",
      sourceVisibility: "atproto_private_space",
      accessBasis: "atproto_space_authority",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: true
    },
    ...overrides
  };
}

function evaluate(input: RecommendationInterestSignalInput) {
  return evaluateRecommendationPublicSignalPolicy({
    action: input.action,
    polarity: input.polarity ?? "neutral",
    targetKind: input.target.kind,
    dataUse: input.dataUse,
    privacyBoundary: input.privacyBoundary ?? "local_only",
    evidence: input.evidence,
    consent: input.consent
  });
}

test("interests kept in the user's own private ATProto space are allowed like a pod", () => {
  const input = spaceSignal();
  assert.deepEqual(evaluate(input), {
    decision: "allow",
    reason: "signal.allow.user_controlled_remote",
    effect: "affinity",
    storageAuthority: "user_owned"
  });
  assert.doesNotThrow(() => normalizeRecommendationInterestSignal(input));
});

test("space evidence needs the user's authority, a user-owned trust boundary and server-side consent", () => {
  const withEvidence = (patch: Record<string, string>) => spaceSignal({
    evidence: { ...spaceSignal().evidence, ...patch } as RecommendationInterestSignalInput["evidence"]
  });
  assert.throws(() => normalizeRecommendationInterestSignal(withEvidence({ trustBoundary: "provider_owned" })), TypeError);
  assert.throws(() => normalizeRecommendationInterestSignal(withEvidence({ accessBasis: "oauth_scope" })), TypeError);
  assert.throws(() => normalizeRecommendationInterestSignal(withEvidence({ protocol: "activitypub" })), TypeError);
  assert.throws(() => normalizeRecommendationInterestSignal(spaceSignal({
    consent: { ...spaceSignal().consent, serverSideProcessing: false }
  })), TypeError);
  assert.throws(() => normalizeRecommendationInterestSignal(spaceSignal({ privacyBoundary: "local_only" })), TypeError);
});

test("public repo evidence never counts as a user-controlled remote placement", () => {
  const publicRepo = spaceSignal({
    evidence: {
      sourceItemKind: "collection",
      protocol: "atproto",
      sourceVisibility: "atproto_public_repo",
      accessBasis: "atproto_public_repo",
      trustBoundary: "user_owned",
      observedAt: OBSERVED_AT
    },
    consent: { ...spaceSignal().consent, sourceVisibility: "atproto_public_repo", accessBasis: "atproto_public_repo" }
  });
  assert.equal(evaluate(publicRepo).decision, "deny");
  assert.throws(() => normalizeRecommendationInterestSignal(publicRepo), TypeError);
  // Even with the user_owned authority spelled out, private interests are not allowed on public evidence.
  const asOwned = evaluateRecommendationPublicSignalPolicy({
    action: "select",
    polarity: "positive",
    targetKind: "canonical_interest",
    dataUse: "local_personalization",
    privacyBoundary: "server_allowed",
    storageAuthority: "user_owned",
    evidence: publicRepo.evidence,
    consent: publicRepo.consent
  });
  assert.equal(asOwned.decision, "deny");
});

test("an onboarding selection kept in a private ATProto space is labelled server_allowed with space evidence", async () => {
  const catalogIndex = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const selection = createRecommendationOnboardingSelection({
    catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
    selectedTopicIds: ["gaming"],
    selectedAt: OBSERVED_AT,
    storageTarget: "atproto_private_space"
  });
  const allUses = ["local_personalization", "ranking"] as const;
  const policy = Object.freeze({ subjectId: SUBJECT_ID, allowedDataUses: allUses, privateDataUses: allUses, serverSideDataUses: allUses });

  const seed = await createRecommendationOnboardingProfileSeed({ subjectId: SUBJECT_ID, catalogIndex, selection, policy });
  assert.ok(seed.signals.length > 0);
  for (const signal of seed.signals) {
    assert.equal(signal.privacyBoundary, "server_allowed");
    assert.equal(signal.evidence.protocol, "atproto");
    assert.equal(signal.evidence.sourceVisibility, "atproto_private_space");
    assert.equal(signal.consent.serverSideProcessing, true);
  }
  await assert.rejects(
    createRecommendationOnboardingProfileSeed({ subjectId: SUBJECT_ID, catalogIndex, selection, policy, privacyBoundary: "local_only" }),
    /user-owned pod or space must use the server_allowed/u
  );
});

test("there is no storage target for a public ATProto repo or a bare PDS", () => {
  assert.ok(RECOMMENDATION_PREFERENCE_STORAGE_TARGETS.includes("atproto_private_space"));
  for (const target of ["atproto_public_repo", "atproto_repo", "atproto_pds", "pds"]) {
    assert.equal((RECOMMENDATION_PREFERENCE_STORAGE_TARGETS as readonly string[]).includes(target), false);
    assert.throws(() => createRecommendationOnboardingSelection({
      catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
      selectedTopicIds: ["gaming"],
      selectedAt: OBSERVED_AT,
      storageTarget: target as never
    }), TypeError);
  }
});
