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

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function fingerprintAnnDeploymentConfig(config: AnnDeploymentConfig): string {
  return hashString(stableStringify(config));
}

export function createAnnConfigSnapshot(input: AnnDeploymentConfigInput, now: () => Date = () => new Date()): AnnConfigSnapshot {
  const config = validateAnnDeploymentConfig(input);

  return {
    fingerprint: fingerprintAnnDeploymentConfig(config),
    config,
    createdAt: now().toISOString()
  };
}

export function diffAnnConfigSnapshots(previous: AnnConfigSnapshot | null, next: AnnConfigSnapshot): AnnConfigDiff {
  return {
    changed: previous?.fingerprint !== next.fingerprint,
    previousFingerprint: previous?.fingerprint ?? null,
    nextFingerprint: next.fingerprint
  };
}
