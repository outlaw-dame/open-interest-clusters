import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRecommendationStateStorageManifest,
  evaluateRecommendationStatePlacement,
  evaluateRecommendationStateStorageManifest,
  getRecommendationStateDomainMetadata,
  normalizeRecommendationStateStorageAdapterManifest,
  type RecommendationStateStorageAdapterManifest
} from "../src/recommendation/state-placement-policy.js";

function manifest(
  overrides: Partial<RecommendationStateStorageAdapterManifest> = {}
): RecommendationStateStorageAdapterManifest {
  return {
    adapterId: "indexeddb-primary",
    domains: ["interest_profile"],
    authority: "device_owned",
    processingBoundary: "local_only",
    persistence: "persistent",
    requiresNetwork: false,
    supportsOffline: true,
    userExportable: true,
    userDeletable: true,
    encryptedAtRest: false,
    ...overrides
  };
}

test("allows persistent device-owned local-first preference state", () => {
  const evaluation = evaluateRecommendationStateStorageManifest(manifest({
    domains: ["interest_profile", "seen_history", "feedback_history", "bandit_state"]
  }));

  assert.equal(evaluation.decision, "allow");
  assert.ok(evaluation.evaluations.every((entry) => entry.reason === "state.allow.device_local_first"));
});

test("allows user-controlled Pod storage without treating it as provider storage", () => {
  const evaluation = evaluateRecommendationStateStorageManifest(manifest({
    adapterId: "solid-pod",
    domains: ["interest_profile", "label_evidence", "profile_embedding"],
    authority: "user_owned",
    processingBoundary: "server_allowed",
    requiresNetwork: true,
    supportsOffline: false
  }));

  assert.equal(evaluation.decision, "allow");
  assert.ok(evaluation.evaluations.every((entry) => entry.reason === "state.allow.user_controlled_remote"));
});

test("denies provider-controlled subject-level recommendation state", () => {
  const evaluation = evaluateRecommendationStatePlacement(manifest({
    adapterId: "application-postgres",
    authority: "provider_owned",
    processingBoundary: "server_allowed",
    requiresNetwork: true,
    supportsOffline: false
  }), "interest_profile");

  assert.deepEqual(evaluation, {
    domain: "interest_profile",
    decision: "deny",
    reason: "state.deny.personal_state_provider_controlled",
    authorityReason: "storage.deny.provider_owned"
  });
});

test("denies a purported device-local adapter that requires the network", () => {
  const evaluation = evaluateRecommendationStatePlacement(manifest({ requiresNetwork: true }), "interest_profile");
  assert.equal(evaluation.decision, "deny");
  assert.equal(evaluation.reason, "state.deny.local_adapter_requires_network");
});

test("denies a purported local-first adapter that cannot operate offline", () => {
  const evaluation = evaluateRecommendationStatePlacement(manifest({ supportsOffline: false }), "interest_profile");
  assert.equal(evaluation.decision, "deny");
  assert.equal(evaluation.reason, "state.deny.local_adapter_not_offline_capable");
});

test("requires deletion for all persistent personal state", () => {
  const evaluation = evaluateRecommendationStatePlacement(manifest({
    domains: ["profile_embedding"],
    userDeletable: false
  }), "profile_embedding");
  assert.equal(evaluation.decision, "deny");
  assert.equal(evaluation.reason, "state.deny.persistent_state_not_user_deletable");
});

test("requires export for persistent user preference and evidence state", () => {
  const evaluation = evaluateRecommendationStatePlacement(manifest({ userExportable: false }), "interest_profile");
  assert.equal(evaluation.decision, "deny");
  assert.equal(evaluation.reason, "state.deny.user_state_not_exportable");
});

test("allows aggregate statistics only in aggregate shared-operator storage", () => {
  const allowed = evaluateRecommendationStatePlacement(manifest({
    adapterId: "aggregate-store",
    domains: ["aggregate_statistics"],
    authority: "shared_operator",
    processingBoundary: "aggregate_only",
    requiresNetwork: true,
    supportsOffline: false,
    userExportable: false,
    userDeletable: false
  }), "aggregate_statistics");
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.reason, "state.allow.aggregate_statistics");

  const denied = evaluateRecommendationStatePlacement(manifest({
    domains: ["aggregate_statistics"]
  }), "aggregate_statistics");
  assert.equal(denied.decision, "deny");
});

test("rejects duplicate domains and undeclared domain evaluation", () => {
  assert.throws(() => normalizeRecommendationStateStorageAdapterManifest(manifest({
    domains: ["interest_profile", "interest_profile"]
  })), /storage adapter manifest/u);

  assert.throws(() => evaluateRecommendationStatePlacement(manifest(), "seen_history"), /not declared/u);
});

test("assertion fails closed when any declared domain violates policy", () => {
  assert.throws(() => assertRecommendationStateStorageManifest(manifest({
    domains: ["interest_profile", "candidate_cache"],
    userDeletable: false
  })), /violates placement policy/u);
});

test("domain metadata keeps personal and aggregate state distinct", () => {
  assert.deepEqual(getRecommendationStateDomainMetadata("dismissal_history"), {
    domain: "dismissal_history",
    subjectLevel: true,
    userPreferenceState: true,
    rebuildable: false
  });
  assert.deepEqual(getRecommendationStateDomainMetadata("aggregate_statistics"), {
    domain: "aggregate_statistics",
    subjectLevel: false,
    userPreferenceState: false,
    rebuildable: true
  });
});
