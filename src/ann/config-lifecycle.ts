import { sha256Fingerprint } from "../runtime/hash.js";
import { validateAnnDeploymentConfig, type AnnDeploymentConfig, type AnnDeploymentConfigInput } from "./deployment-config.js";

export const ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION = 1;

export interface AnnConfigSnapshot {
  schemaVersion: typeof ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION;
  fingerprint: string;
  config: AnnDeploymentConfig;
  createdAt: string;
}

export interface AnnConfigDiff {
  changed: boolean;
  previousFingerprint: string | null;
  nextFingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableStringifyForAnnConfig(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForAnnConfig(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringifyForAnnConfig(record[key])}`).join(",")}}`;
}

function cloneConfig(config: AnnDeploymentConfig): AnnDeploymentConfig {
  return {
    profile: config.profile,
    requirement: { ...config.requirement },
    deployment: { ...config.deployment }
  };
}

export function assertValidAnnConfigSnapshot(snapshot: AnnConfigSnapshot): void {
  if (snapshot.schemaVersion !== ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("ANN config snapshot schema version is unsupported");
  }

  if (!Number.isFinite(Date.parse(snapshot.createdAt))) {
    throw new Error("ANN config snapshot createdAt is invalid");
  }

  if (snapshot.fingerprint !== fingerprintAnnDeploymentConfig(snapshot.config)) {
    throw new Error("ANN config snapshot fingerprint does not match config");
  }
}

function parseSnapshotRecord(value: unknown): AnnConfigSnapshot {
  if (!isRecord(value)) throw new Error("ANN config snapshot must be an object");
  if (!isRecord(value.config)) throw new Error("ANN config snapshot config must be an object");
  if (typeof value.createdAt !== "string") throw new Error("ANN config snapshot createdAt must be a string");
  if (typeof value.fingerprint !== "string") throw new Error("ANN config snapshot fingerprint must be a string");

  const snapshot: AnnConfigSnapshot = {
    schemaVersion: value.schemaVersion as typeof ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    fingerprint: value.fingerprint,
    createdAt: value.createdAt,
    config: value.config as unknown as AnnConfigSnapshot["config"]
  };

  assertValidAnnConfigSnapshot(snapshot);
  return freezeAnnConfigSnapshot(cloneAnnConfigSnapshot(snapshot));
}

export function cloneAnnConfigSnapshot(snapshot: AnnConfigSnapshot): AnnConfigSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    fingerprint: snapshot.fingerprint,
    createdAt: snapshot.createdAt,
    config: cloneConfig(snapshot.config)
  };
}

export function freezeAnnConfigSnapshot(snapshot: AnnConfigSnapshot): AnnConfigSnapshot {
  Object.freeze(snapshot.config.requirement);
  Object.freeze(snapshot.config.deployment);
  Object.freeze(snapshot.config);
  return Object.freeze(snapshot);
}

export function fingerprintAnnDeploymentConfig(config: AnnDeploymentConfig): string {
  return sha256Fingerprint(stableStringifyForAnnConfig(config));
}

export function createAnnConfigSnapshot(input: AnnDeploymentConfigInput, now: () => Date = () => new Date()): AnnConfigSnapshot {
  const config = validateAnnDeploymentConfig(input);
  return freezeAnnConfigSnapshot({
    schemaVersion: ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
    fingerprint: fingerprintAnnDeploymentConfig(config),
    config: cloneConfig(config),
    createdAt: now().toISOString()
  });
}

export function serializeAnnConfigSnapshot(snapshot: AnnConfigSnapshot): string {
  assertValidAnnConfigSnapshot(snapshot);
  return stableStringifyForAnnConfig(snapshot);
}

export function deserializeAnnConfigSnapshot(serialized: string): AnnConfigSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("ANN config snapshot JSON is invalid");
  }

  return parseSnapshotRecord(parsed);
}

export function migrateAnnConfigSnapshot(snapshot: AnnConfigSnapshot): AnnConfigSnapshot {
  assertValidAnnConfigSnapshot(snapshot);
  return freezeAnnConfigSnapshot(cloneAnnConfigSnapshot(snapshot));
}

export function diffAnnConfigSnapshots(previous: AnnConfigSnapshot | null, next: AnnConfigSnapshot): AnnConfigDiff {
  return {
    changed: previous?.fingerprint !== next.fingerprint,
    previousFingerprint: previous?.fingerprint ?? null,
    nextFingerprint: next.fingerprint
  };
}
