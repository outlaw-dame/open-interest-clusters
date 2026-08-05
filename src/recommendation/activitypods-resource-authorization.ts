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
  now?: string | undefined;
}

const MAX_IDENTIFIER_LENGTH = 2_048;
const ACCESS_MODE_SET = new Set<string>(RECOMMENDATION_SOLID_ACCESS_MODES);
const OPERATION_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS);
const LEAP_SECOND_PATTERN = /T\d{2}:\d{2}:60(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH || hasUnsafeControlCharacter(value)
  ) throw new TypeError(`Invalid ActivityPods ${label}.`);
  return value;
}

function time(value: unknown, label: string): string {
  const output = string(value, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypods-resource-grant", since: output });
  if (LEAP_SECOND_PATTERN.test(output) || !Number.isFinite(Date.parse(output))) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  return output;
}

function url(value: unknown, label: string, directory = false): string {
  let output: URL;
  try { output = new URL(string(value, label)); }
  catch { throw new TypeError(`Invalid ActivityPods ${label}.`); }
  const host = output.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    output.protocol !== "https:" || output.username !== "" || output.password !== "" || output.hash !== "" ||
    host.length === 0 || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":") ||
    (directory && !output.pathname.endsWith("/"))
  ) throw new TypeError(`Invalid ActivityPods ${label}.`);
  output.hostname = host;
  return output.toString();
}

function within(child: string, parent: string): boolean {
  const childUrl = new URL(child);
  const parentUrl = new URL(parent);
  return childUrl.origin === parentUrl.origin && childUrl.pathname.startsWith(parentUrl.pathname);
}

function sameOwnerOrigin(value: string, ownerWebId: string, label: string): void {
  if (new URL(value).origin !== new URL(ownerWebId).origin) {
    throw new TypeError(`ActivityPods ${label} must use the owner Pod authority.`);
  }
}

function modes(value: unknown, label: string): readonly RecommendationSolidAccessMode[] {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.some((mode) => typeof mode !== "string" || !ACCESS_MODE_SET.has(mode)) ||
    new Set(value).size !== value.length
  ) throw new TypeError(`Invalid ActivityPods ${label}.`);
  return Object.freeze([...value]) as readonly RecommendationSolidAccessMode[];
}

function boolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid ActivityPods ${label}.`);
  return value;
}

function readAllowed(value: readonly RecommendationSolidAccessMode[]): boolean {
  return value.includes("read") || value.includes("control");
}

function writeAllowed(value: readonly RecommendationSolidAccessMode[]): boolean {
  return value.includes("write") || value.includes("control");
}

function operation(value: unknown): RecommendationActivityPodsResourceOperation {
  if (typeof value !== "string" || !OPERATION_SET.has(value)) {
    throw new TypeError("Invalid ActivityPods resource operation.");
  }
  return value as RecommendationActivityPodsResourceOperation;
}

function validateTimes(
  checkedAt: string,
  expiresAt: string | undefined,
  revokedAt: string | undefined,
  options: RecommendationActivityPodsResourceGrantValidationOptions
): void {
  if (!isRecord(options)) throw new TypeError("Invalid ActivityPods resource grant validation options.");
  if (revokedAt !== undefined) throw new TypeError("ActivityPods resource grant has been revoked.");
  const now = time(options.now ?? new Date().toISOString(), "resource grant validation time");
  const checked = Date.parse(checkedAt);
  const nowMillis = Date.parse(now);
  if (checked > nowMillis) throw new TypeError("ActivityPods resource grant check time is in the future.");
  if (expiresAt !== undefined) {
    const expires = Date.parse(expiresAt);
    if (expires <= checked) throw new TypeError("ActivityPods resource grant expiry must follow its check time.");
    if (expires <= nowMillis) throw new TypeError("ActivityPods resource grant has expired.");
  }
}

export function normalizeRecommendationActivityPodsResourceGrantEvidence(
  input: RecommendationActivityPodsResourceGrantEvidenceInput,
  options: RecommendationActivityPodsResourceGrantValidationOptions = {}
): RecommendationActivityPodsResourceGrantEvidence {
  if (!isRecord(input)) throw new TypeError("Invalid ActivityPods resource grant evidence.");
  const subjectId = string(input.subjectId, "resource grant subject");
  const applicationActorUri = url(input.applicationActorUri, "application actor URI");
  const ownerActorUri = url(input.ownerActorUri, "owner actor URI");
  const ownerWebId = url(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) throw new TypeError("ActivityPods owner actor URI must equal the owner WebID.");
  if (applicationActorUri === ownerActorUri) throw new TypeError("ActivityPods application actor must be distinct from the owner actor.");

  const storageRootUri = url(input.storageRootUri, "storage root URI", true);
  const containerUri = url(input.containerUri, "resource container URI", true);
  const resourceUri = url(input.resourceUri, "resource URI");
  const applicationRegistrationUri = url(input.applicationRegistrationUri, "application registration URI");
  const accessGrantUri = url(input.accessGrantUri, "access grant URI");
  const dataGrantUri = url(input.dataGrantUri, "data grant URI");
  const shapeTreeUri = url(input.shapeTreeUri, "shape tree URI");
  for (const [value, label] of [
    [storageRootUri, "storage root URI"], [containerUri, "resource container URI"],
    [resourceUri, "resource URI"], [applicationRegistrationUri, "application registration URI"],
    [accessGrantUri, "access grant URI"], [dataGrantUri, "data grant URI"]
  ] as const) sameOwnerOrigin(value, ownerWebId, label);
  if (!within(containerUri, storageRootUri)) throw new TypeError("ActivityPods resource container must be within the owner storage root.");
  if (!within(resourceUri, containerUri)) throw new TypeError("ActivityPods resource must be within its authorized container.");

  const resourceAccessModes = modes(input.resourceAccessModes, "resource access modes");
  const containerAccessModes = modes(input.containerAccessModes, "container access modes");
  const isOwner = boolean(input.isOwner, "resource owner flag") ?? false;
  if (!isOwner && !readAllowed(resourceAccessModes) && !writeAllowed(resourceAccessModes) && !writeAllowed(containerAccessModes)) {
    throw new TypeError("ActivityPods resource grant does not provide usable access.");
  }
  const checkedAt = time(input.checkedAt, "resource grant check time");
  const expiresAt = input.expiresAt === undefined ? undefined : time(input.expiresAt, "resource grant expiry time");
  const revokedAt = input.revokedAt === undefined ? undefined : time(input.revokedAt, "resource grant revocation time");
  validateTimes(checkedAt, expiresAt, revokedAt, options);
  const providerPolicyAllowsProcessing = boolean(input.providerPolicyAllowsProcessing, "resource grant provider-policy flag");

  const output: RecommendationActivityPodsResourceGrantEvidence = {
    subjectId, applicationActorUri, applicationRegistrationUri, accessGrantUri, dataGrantUri,
    ownerActorUri, ownerWebId, storageRootUri, containerUri, resourceUri, shapeTreeUri,
    resourceAccessModes, containerAccessModes, isOwner, checkedAt
  };
  if (expiresAt !== undefined) output.expiresAt = expiresAt;
  if (providerPolicyAllowsProcessing !== undefined) output.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return Object.freeze(output);
}

export function requireRecommendationActivityPodsResourceOperation(
  input: RecommendationActivityPodsResourceGrantEvidenceInput,
  requestedOperation: RecommendationActivityPodsResourceOperation,
  options: RecommendationActivityPodsResourceGrantValidationOptions = {}
): RecommendationActivityPodsResourceGrantEvidence {
  const requested = operation(requestedOperation);
  const evidence = normalizeRecommendationActivityPodsResourceGrantEvidence(input, options);
  if (evidence.providerPolicyAllowsProcessing === false) throw new TypeError("ActivityPods provider policy denies resource processing.");
  if (evidence.isOwner) return evidence;
  if (requested === "read") {
    if (!readAllowed(evidence.resourceAccessModes)) throw new TypeError("ActivityPods resource grant does not allow read.");
    return evidence;
  }
  if (requested === "write") {
    if (!readAllowed(evidence.resourceAccessModes) || !writeAllowed(evidence.resourceAccessModes)) {
      throw new TypeError("ActivityPods resource grant must allow read and write for conditional profile updates.");
    }
    if (!writeAllowed(evidence.containerAccessModes)) {
      throw new TypeError("ActivityPods resource grant does not allow writes in the profile container.");
    }
    return evidence;
  }
  if (
    !readAllowed(evidence.resourceAccessModes) || !writeAllowed(evidence.resourceAccessModes) ||
    !writeAllowed(evidence.containerAccessModes)
  ) throw new TypeError("ActivityPods resource deletion requires read/write access to the resource and write access to its container.");
  return evidence;
}
