import test from "node:test";
import assert from "node:assert/strict";

import {
  ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  createAnnConfigSnapshot,
  fingerprintAnnDeploymentConfig,
  stableStringifyForAnnConfig
} from "../src/index.js";

test("stable ANN config serialization is order-independent", () => {
  const left = {
    deployment: { environment: "browser", preferLocalFirst: true },
    requirement: { metadataFiltering: true, persistence: "local" }
  };

  const right = {
    requirement: { persistence: "local", metadataFiltering: true },
    deployment: { preferLocalFirst: true, environment: "browser" }
  };

  assert.equal(stableStringifyForAnnConfig(left), stableStringifyForAnnConfig(right));
});

test("ANN config fingerprint is deterministic across key order", () => {
  const left = fingerprintAnnDeploymentConfig({
    profile: "browser",
    requirement: { metadataFiltering: true, persistence: "local" },
    deployment: { environment: "browser", preferLocalFirst: true }
  });

  const right = fingerprintAnnDeploymentConfig({
    profile: "browser",
    requirement: { persistence: "local", metadataFiltering: true },
    deployment: { preferLocalFirst: true, environment: "browser" }
  });

  assert.equal(left, right);
});

test("ANN config snapshot is frozen and versioned", () => {
  const snapshot = createAnnConfigSnapshot({
    profile: "browser",
    requirement: { metadataFiltering: true }
  });

  assert.equal(snapshot.schemaVersion, ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.config), true);
  assert.equal(Object.isFrozen(snapshot.config.requirement), true);
  assert.equal(Object.isFrozen(snapshot.config.deployment), true);
});
