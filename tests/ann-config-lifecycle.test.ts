import test from "node:test";
import assert from "node:assert/strict";

import {
  ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  createAnnConfigSnapshot,
  deserializeAnnConfigSnapshot,
  fingerprintAnnDeploymentConfig,
  serializeAnnConfigSnapshot,
  stableStringifyForAnnConfig,
  type AnnConfigSnapshot
} from "../src/index.js";

function tamper(snapshot: AnnConfigSnapshot, patch: Partial<AnnConfigSnapshot>): AnnConfigSnapshot {
  return { ...snapshot, ...patch };
}

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

test("ANN config snapshot serialization round-trips safely", () => {
  const snapshot = createAnnConfigSnapshot({
    profile: "server",
    requirement: { metadataFiltering: true }
  }, () => new Date("2026-01-01T00:00:00.000Z"));

  const restored = deserializeAnnConfigSnapshot(serializeAnnConfigSnapshot(snapshot));

  assert.deepEqual(restored, snapshot);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(Object.isFrozen(restored.config), true);
  assert.equal(Object.isFrozen(restored.config.requirement), true);
  assert.equal(Object.isFrozen(restored.config.deployment), true);
});

test("ANN config snapshot deserialization rejects invalid JSON", () => {
  assert.throws(() => deserializeAnnConfigSnapshot("{"), {
    message: "ANN config snapshot JSON is invalid"
  });
});

test("ANN config snapshot deserialization rejects non-object roots", () => {
  assert.throws(() => deserializeAnnConfigSnapshot("null"), {
    message: "ANN config snapshot must be an object"
  });

  assert.throws(() => deserializeAnnConfigSnapshot("[]"), {
    message: "ANN config snapshot must be an object"
  });
});

test("ANN config snapshot deserialization rejects invalid nested shape", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { config: [] as never }))), {
    message: "ANN config snapshot config must be an object"
  });
});

test("ANN config snapshot deserialization rejects invalid createdAt type", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { createdAt: 123 as never }))), {
    message: "ANN config snapshot createdAt must be a string"
  });
});

test("ANN config snapshot deserialization rejects invalid fingerprint type", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { fingerprint: 123 as never }))), {
    message: "ANN config snapshot fingerprint must be a string"
  });
});

test("ANN config snapshot deserialization rejects invalid createdAt value", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { createdAt: "not-a-date" }))), {
    message: "ANN config snapshot createdAt is invalid"
  });
});

test("ANN config snapshot deserialization rejects unsupported schema", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { schemaVersion: 999 as never }))), {
    message: "ANN config snapshot schema version is unsupported"
  });
});

test("ANN config snapshot deserialization rejects fingerprint mismatch", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => deserializeAnnConfigSnapshot(JSON.stringify(tamper(snapshot, { fingerprint: "sha256:bad" }))), {
    message: "ANN config snapshot fingerprint does not match config"
  });
});

test("ANN config snapshot serialization rejects invalid snapshots", () => {
  const snapshot = createAnnConfigSnapshot({ profile: "browser", requirement: { metadataFiltering: true } });

  assert.throws(() => serializeAnnConfigSnapshot(tamper(snapshot, { fingerprint: "sha256:bad" })), {
    message: "ANN config snapshot fingerprint does not match config"
  });
});
