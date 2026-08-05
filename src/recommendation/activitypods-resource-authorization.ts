import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_SOLID_ACCESS_MODES,
  type RecommendationSolidAccessMode
} from "./protocol-source-contexts.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS = ["read", "write", "delete"] as const;
export type RecommendationActivityPodsResourceOperation =
  typeof RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS[number];

export interface RecommendationActivityPodsResourceGrantEvidenceInput {
  subjectId: string;
  applicationActorUri: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri: string;
  ownerActorUri: string;
  ownerWebId: string;
  storageRootUri: string;
  containerUri: string;
  resourceUri: string;
  shapeTreeUri: string;
  resourceAccessModes: readonly RecommendationSolidAccessMode[];
  containerAccessModes: readonly RecommendationSolidAccessMode[];
  isOwner?: boolean;
  checkedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsResourceGrantEvidence {
  subjectId: string;
  applicationActorUri: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri: string;
  ownerActorUri: string;
  ownerWebId: string;
  storageRootUri: string;
  containerUri: string;
  resourceUri: string;
  shapeTreeUri: string;
  resourceAccessModes: readonly RecommendationSolidAccessMode[];
  containerAccessModes: readonly RecommendationSolidAccessMode[];
  isOwner: boolean;
  checkedAt: string;
  expiresAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsResourceGrantValidationOptions {
  now?: string;
}

const MAX_IDENTIFIER_LENGTH = 2_048;
const ACCESS_MODE_SET = new Set<string>(RECOMMENDATION_SOLID_ACCESS_MODES);
const OPERATION_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = boundedString(value, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypods-resource-grant", since: normalized });
  return normalized;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : timestamp(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid ActivityPods ${label}.`);
  return value;
}

function httpsUrl(value: unknown, label: string, requireDirectory = false): string {
  const raw = boundedString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.includes(":") ||
    (requireDirectory && !url.pathname.endsWith("/"))
  ) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  url.hostname = hostname;
  return url.toString();
}

function isWithin(childUri: string, parentUri: string): boolean {
  const child = new URL(childUri);
  const parent = new URL(parentUri);
  return child.origin === parent.origin && child.pathname.startsWith(parent.pathname);
}

function assertSameOrigin(uri: string, ownerWebId: string, label: string): void {
  if (new URL(uri).origin !== new URL(ownerWebId).origin) {
    throw new TypeError(`ActivityPods ${label} must use the owner Pod authority.`);
  }
}

function accessModes(value: unknown, label: string): readonly RecommendationSolidAccessMode[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((mode) => typeof mode !== "string" || !ACCESS_MODE_SET.has(mode)) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  return Object.freeze([...value]) as readonly RecommendationSolidAccessMode[];
}

function normalizeNow(options: RecommendationActivityPodsResourceGrantValidationOptions): string {
  if (!isPlainRecord(options)) {
    throw new TypeError("Invalid ActivityPods resource grant validation options.");
  }
  return options.now === undefined
    ? new Date().toISOString()
    : timestamp(options.now, "resource grant validation time");
}

function assertTemporalValidity(
  checkedAt: string,
  expiresAt: string | undefined,
  revokedAt: string | undefined,
  now: string
): void {
  if (revokedAt !== undefined) throw new TypeError("ActivityPods resource grant has been revoked.");
  const checkedAtMs = Date.parse(checkedAt);
  const nowMs = Date.parse(now);
  if (checkedAtMs > nowMs) throw new TypeError("ActivityPods resource grant check time is in the future.");
  if (expiresAt !== undefined) {
    const expiresAtMs = Date.parse(expiresAt);
    if (expiresAtMs <= checkedAtMs) {
      throw new TypeError("ActivityPods resource grant expiry must follow its check time.");
    }
    if (expiresAtMs <= nowMs) throw new TypeError("ActivityPods resource grant has expired.");
  }
}

function hasRead(modes: readonly RecommendationSolidAccessMode[]): boolean {
  return modes.includes("read") || modes.includes("control");
}

function hasWrite(modes: readonly RecommendationSolidAccessMode[]): boolean {
  return modes.includes("write") || modes.includes("control");
}

function normalizeOperation(value: unknown): RecommendationActivityPodsResourceOperation {
  if (typeof value !== "string" || !OPERATION_SET.has(value)) {
    throw new TypeError("Invalid ActivityPods resource operation.");
  }
  return value as RecommendationActivityPodsResourceOperation;
}

export function normalizeRecommendationActivityPodsResourceGrantEvidence(
  input: RecommendationActivityPodsResourceGrantEvidenceInput,
  options: RecommendationActivityPodsResourceGrantValidationOptions = {}
): RecommendationActivityPodsResourceGrantEvidence {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ActivityPods resource grant evidence.");

  const subjectId = boundedString(input.subjectId, "resource grant subject");
  const applicationActorUri = httpsUrl(input.applicationActorUri, "application actor URI");
  const ownerActorUri = httpsUrl(input.ownerActorUri, "owner actor URI");
  const ownerWebId = httpsUrl(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) {
    throw new TypeError("ActivityPods owner actor URI must equal the owner WebID.");
  }
  if (applicationActorUri === ownerActorUri) {
    throw new TypeError("ActivityPods application actor must be distinct from the owner actor.");
  }

  const storageRootUri = httpsUrl(input.storageRootUri, "storage root URI", true);
  const containerUri = httpsUrl(input.containerUri, "resource container URI", true);
  const resourceUri = httpsUrl(input.resourceUri, "resource URI");
  const applicationRegistrationUri = httpsUrl(
    input.applicationRegistrationUri,
    "application registration URI"
  );
  const accessGrantUri = httpsUrl(input.accessGrantUri, "access grant URI");
  const dataGrantUri = httpsUrl(input.dataGrantUri, "data grant URI");
  const shapeTreeUri = httpsUrl(input.shapeTreeUri, "shape tree URI");

  for (const [uri, label] of [
    [storageRootUri, "storage root URI"],
    [containerUri, "resource container URI"],
    [resourceUri, "resource URI"],
    [applicationRegistrationUri, "application registration URI"],
    [accessGrantUri, "access grant URI"],
    [dataGrantUri, "data grant URI"]
  ] as const) {
    assertSameOrigin(uri, ownerWebId, label);
  }
  if (!isWithin(containerUri, storageRootUri)) {
    throw new TypeError("ActivityPods resource container must be within the owner storage root.");
  }
  if (!isWithin(resourceUri, containerUri)) {
    throw new TypeError("ActivityPods resource must be within its authorized container.");
  }

  const resourceAccessModes = accessModes(input.resourceAccessModes, "resource access modes");
  const containerAccessModes = accessModes(input.containerAccessModes, "container access modes");
  const isOwner = optionalBoolean(input.isOwner, "resource owner flag") ?? false;
  if (
    !isOwner &&
    !hasRead(resourceAccessModes) &&
    !hasWrite(resourceAccessModes) &&
    !hasWrite(containerAccessModes)
  ) {
    throw new TypeError("ActivityPods resource grant does not provide usable access.");
  }

  const checkedAt = timestamp(input.checkedAt, "resource grant check time");
  const expiresAt = optionalTimestamp(input.expiresAt, "resource grant expiry time");
  const revokedAt = optionalTimestamp(input.revokedAt, "resource grant revocation time");
  assertTemporalValidity(checkedAt, expiresAt, revokedAt, normalizeNow(options));
  const providerPolicyAllowsProcessing = optionalBoolean(
    input.providerPolicyAllowsProcessing,
    "resource grant provider-policy flag"
  );

  const evidence: RecommendationActivityPodsResourceGrantEvidence = {
    subjectId,
    applicationActorUri,
    applicationRegistrationUri,
    accessGrantUri,
    dataGrantUri,
    ownerActorUri,
    ownerWebId,
    storageRootUri,
    containerUri,
    resourceUri,
    shapeTreeUri,
    resourceAccessModes,
    containerAccessModes,
    isOwner,
    checkedAt
  };
  if (expiresAt !== undefined) evidence.expiresAt = expiresAt;
  if (providerPolicyAllowsProcessing !== undefined) {
    evidence.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  }
  return Object.freeze(evidence);
}

export function requireRecommendationActivityPodsResourceOperation(
  input: RecommendationActivityPodsResourceGrantEvidenceInput,
  operation: RecommendationActivityPodsResourceOperation,
  options: RecommendationActivityPodsResourceGrantValidationOptions = {}
): RecommendationActivityPodsResourceGrantEvidence {
  const normalizedOperation = normalizeOperation(operation);
  const evidence = normalizeRecommendationActivityPodsResourceGrantEvidence(input, options);
  if (evidence.providerPolicyAllowsProcessing === false) {
    throw new TypeError("ActivityPods provider policy denies resource processing.");
  }
  if (evidence.isOwner) return evidence;

  if (normalizedOperation === "read") {
    if (!hasRead(evidence.resourceAccessModes)) {
      throw new TypeError("ActivityPods resource grant does not allow read.");
    }
    return evidence;
  }

  if (normalizedOperation === "write") {
    if (!hasRead(evidence.resourceAccessModes) || !hasWrite(evidence.resourceAccessModes)) {
      throw new TypeError(
        "ActivityPods resource grant must allow read and write for conditional profile updates."
      );
    }
    if (!hasWrite(evidence.containerAccessModes)) {
      throw new TypeError("ActivityPods resource grant does not allow writes in the profile container.");
    }
    return evidence;
  }

  if (
    !hasRead(evidence.resourceAccessModes) ||
    !hasWrite(evidence.resourceAccessModes) ||
    !hasWrite(evidence.containerAccessModes)
  ) {
    throw new TypeError(
      "ActivityPods resource deletion requires read/write access to the resource and write access to its container."
    );
  }
  return evidence;
}
