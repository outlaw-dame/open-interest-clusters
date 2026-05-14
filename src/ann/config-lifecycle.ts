import { sha256Fingerprint } from "../runtime/hash.js";
import { validateAnnDeploymentConfig, type AnnDeploymentConfig, type AnnDeploymentConfigInput } from "./deployment-config.js";

export interface AnnConfigSnapshot {
  fingerprint: string;
  config: AnnDeploymentConfig;
  createdAt: string;
}

export interface AnnConfigDiff {
  changed: boolean;
  previousFingerprint: string | null;
  nextFingerprint: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function cloneConfig(config: AnnDeploymentConfig): AnnDeploymentConfig {
  return {
    profile: config.profile,
    requirement: { ...config.requirement },
    deployment: { ...config.deployment }
  };
}

export function cloneAnnConfigSnapshot(snapshot: AnnConfigSnapshot): AnnConfigSnapshot {
  return {
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
  return sha256Fingerprint(stableStringify(config));
}

export function createAnnConfigSnapshot(input: AnnDeploymentConfigInput, now: () => Date = () => new Date()): AnnConfigSnapshot {
  const config = validateAnnDeploymentConfig(input);
  return freezeAnnConfigSnapshot({
    fingerprint: fingerprintAnnDeploymentConfig(config),
    config: cloneConfig(config),
    createdAt: now().toISOString()
  });
}

export function diffAnnConfigSnapshots(previous: AnnConfigSnapshot | null, next: AnnConfigSnapshot): AnnConfigDiff {
  return {
    changed: previous?.fingerprint !== next.fingerprint,
    previousFingerprint: previous?.fingerprint ?? null,
    nextFingerprint: next.fingerprint
  };
}
