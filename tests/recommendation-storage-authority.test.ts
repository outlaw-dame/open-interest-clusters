import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecommendationStorageAuthority,
  inferLegacyRecommendationStorageAuthority,
  isRecommendationProcessingBoundary,
  isRecommendationStorageAuthority
} from "../src/index.js";

test("storage authority recognizes device, user, provider, and shared ownership", () => {
  assert.equal(isRecommendationStorageAuthority("device_owned"), true);
  assert.equal(isRecommendationStorageAuthority("user_owned"), true);
  assert.equal(isRecommendationStorageAuthority("provider_owned"), true);
  assert.equal(isRecommendationStorageAuthority("shared_operator"), true);
  assert.equal(isRecommendationStorageAuthority("server"), false);
});

test("processing boundary remains separate from storage authority", () => {
  assert.equal(isRecommendationProcessingBoundary("local_only"), true);
  assert.equal(isRecommendationProcessingBoundary("server_allowed"), true);
  assert.equal(isRecommendationProcessingBoundary("aggregate_only"), true);
  assert.equal(isRecommendationProcessingBoundary("user_owned"), false);
});

test("legacy boundary inference is fail-closed for remote personalized state", () => {
  assert.equal(inferLegacyRecommendationStorageAuthority("local_only"), "device_owned");
  assert.equal(inferLegacyRecommendationStorageAuthority("server_allowed"), "provider_owned");
  assert.equal(inferLegacyRecommendationStorageAuthority("aggregate_only"), "shared_operator");
});

test("device-owned state is allowed only with local processing", () => {
  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "device_owned",
      processingBoundary: "local_only"
    }),
    { decision: "allow", reason: "storage.allow.device_owned" }
  );

  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "device_owned",
      processingBoundary: "server_allowed"
    }),
    { decision: "deny", reason: "storage.deny.authority_boundary_mismatch" }
  );
});

test("user-owned remote state is distinct from provider-owned remote state", () => {
  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "user_owned",
      processingBoundary: "server_allowed"
    }),
    { decision: "allow", reason: "storage.allow.user_owned" }
  );

  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "provider_owned",
      processingBoundary: "server_allowed"
    }),
    { decision: "deny", reason: "storage.deny.provider_owned" }
  );
});

test("aggregate state requires the shared-operator authority class", () => {
  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "shared_operator",
      processingBoundary: "aggregate_only"
    }),
    { decision: "allow", reason: "storage.allow.aggregate_only" }
  );

  assert.deepEqual(
    evaluateRecommendationStorageAuthority({
      authority: "user_owned",
      processingBoundary: "aggregate_only"
    }),
    { decision: "deny", reason: "storage.deny.authority_boundary_mismatch" }
  );
});
