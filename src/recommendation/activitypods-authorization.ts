import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import {
  RECOMMENDATION_SOLID_ACCESS_MODES,
  type RecommendationSolidAccessMode
} from "./protocol-source-contexts.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_ACTIVITYPODS_BOX_TYPES = ["inbox", "outbox"] as const;
export type RecommendationActivityPodsBoxType = typeof RECOMMENDATION_ACTIVITYPODS_BOX_TYPES[number];

export const RECOMMENDATION_ACTIVITYPODS_SPECIAL_RIGHTS = [
  "apods:ReadInbox",
  "apods:ReadOutbox",
  "apods:PostOutbox",
  "apods:SendNotification",
  "apods:CreateWacGroup",
  "apods:CreateCollection",
  "apods:UpdateWebId"
] as const;
export type RecommendationActivityPodsSpecialRight =
  typeof RECOMMENDATION_ACTIVITYPODS_SPECIAL_RIGHTS[number];

export const RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS = ["read", "write", "delete"] as const;
export type RecommendationActivityPodsResourceOperation =
  typeof RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS[number];

export interface RecommendationActivityPodsApplicationIdentityInput {
  applicationActorUri: string;
  ownerActorUri: string;
  ownerWebId: string;
}

export interface RecommendationActivityPodsBoxGrantEvidenceInput
  extends RecommendationActivityPodsApplicationIdentityInput {
  subjectId: string;
  boxType: RecommendationActivityPodsBoxType;
  boxUri: string;
  rights: readonly RecommendationActivityPodsSpecialRight[];
  checkedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsBoxGrantEvidence {
  subjectId: string;
  applicationActorUri: string;
  ownerActorUri: string;
  ownerWebId: string;
  boxType: RecommendationActivityPodsBoxType;
  boxUri: string;
  requiredRight: "apods:ReadInbox" | "apods:ReadOutbox";
  rights: readonly RecommendationActivityPodsSpecialRight[];
  checkedAt: string;
  expiresAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsResourceGrantEvidenceInput
  extends RecommendationActivityPodsApplicationIdentityInput {
  subjectId: string;
  resourceUri: string;
  accessModes: readonly RecommendationSolidAccessMode[];
  isOwner?: boolean;
  checkedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsResourceGrantEvidence {
  subjectId: string;
  applicationActorUri: string;
  ownerActorUri: string;
  ownerWebId: string;
  resourceUri: string;
  accessModes: readonly RecommendationSolidAccessMode[];
  isOwner: boolean;
  checkedAt: string;
  expiresAt?: string;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPodsGrantValidationOptions {
  now?: string;
}

const MAX_IDENTIFIER_LENGTH = 2_048;
const BOX_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_BOX_TYPES);
const SPECIAL_RIGHT_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_SPECIAL_RIGHTS);
const SOLID_ACCESS_MODE_SET = new Set<string>(RECOMMENDATION_SOLID_ACCESS_MODES);

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
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypods-grant", since: normalized });
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

function normalizeHttpsUrl(value: unknown, label: string): string {
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
    hostname.includes(":")
  ) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  url.hostname = hostname;
  return url.toString();
}

function normalizeIdentity(input: RecommendationActivityPodsApplicationIdentityInput): {
  applicationActorUri: string;
  ownerActorUri: string;
  ownerWebId: string;
} {
  const applicationActorUri = normalizeHttpsUrl(input.applicationActorUri, "application actor URI");
  const ownerActorUri = normalizeHttpsUrl(input.ownerActorUri, "owner actor URI");
  const ownerWebId = normalizeHttpsUrl(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) {
    throw new TypeError("ActivityPods owner actor URI must equal the owner WebID.");
  }
  if (applicationActorUri === ownerActorUri) {
    throw new TypeError("ActivityPods application actor must be distinct from the owner actor.");
  }
  return { applicationActorUri, ownerActorUri, ownerWebId };
}

function normalizeNow(options: RecommendationActivityPodsGrantValidationOptions): string {
  if (!isPlainRecord(options)) throw new TypeError("Invalid ActivityPods grant validation options.");
  return options.now === undefined
    ? new Date().toISOString()
    : timestamp(options.now, "grant validation time");
}

function assertTemporalValidity(
  checkedAt: string,
  expiresAt: string | undefined,
  revokedAt: string | undefined,
  now: string
): void {
  if (revokedAt !== undefined) throw new TypeError("ActivityPods grant has been revoked.");
  const checkedAtMs = Date.parse(checkedAt);
  const nowMs = Date.parse(now);
  if (expiresAt !== undefined) {
    const expiresAtMs = Date.parse(expiresAt);
    if (expiresAtMs <= checkedAtMs) throw new TypeError("ActivityPods grant expiry must follow its check time.");
    if (expiresAtMs <= nowMs) throw new TypeError("ActivityPods grant has expired.");
  }
  if (checkedAtMs > nowMs) {
    throw new TypeError("ActivityPods grant check time is in the future.");
  }
}

function uniqueKnownStrings<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string
): readonly T[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !allowed.has(item))) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`Invalid ActivityPods ${label}.`);
  return Object.freeze([...value]) as readonly T[];
}

function boxType(value: unknown): RecommendationActivityPodsBoxType {
  if (typeof value !== "string" || !BOX_TYPE_SET.has(value)) throw new TypeError("Invalid ActivityPods box type.");
  return value as RecommendationActivityPodsBoxType;
}

function requiredBoxRight(value: RecommendationActivityPodsBoxType): "apods:ReadInbox" | "apods:ReadOutbox" {
  return value === "inbox" ? "apods:ReadInbox" : "apods:ReadOutbox";
}

function assertSameOwnerAuthority(uri: string, ownerActorUri: string, label: string): void {
  if (new URL(uri).origin !== new URL(ownerActorUri).origin) {
    throw new TypeError(`ActivityPods ${label} must use the owner Pod authority.`);
  }
}

export function normalizeRecommendationActivityPodsBoxGrantEvidence(
  input: RecommendationActivityPodsBoxGrantEvidenceInput,
  options: RecommendationActivityPodsGrantValidationOptions = {}
): RecommendationActivityPodsBoxGrantEvidence {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ActivityPods box grant evidence.");
  const identity = normalizeIdentity(input);
  const normalizedBoxType = boxType(input.boxType);
  const boxUri = normalizeHttpsUrl(input.boxUri, "box URI");
  assertSameOwnerAuthority(boxUri, identity.ownerActorUri, "box URI");
  const rights = uniqueKnownStrings<RecommendationActivityPodsSpecialRight>(
    input.rights,
    SPECIAL_RIGHT_SET,
    "special rights"
  );
  const requiredRight = requiredBoxRight(normalizedBoxType);
  if (!rights.includes(requiredRight)) throw new TypeError(`ActivityPods grant lacks ${requiredRight}.`);
  const checkedAt = timestamp(input.checkedAt, "grant check time");
  const expiresAt = optionalTimestamp(input.expiresAt, "grant expiry time");
  const revokedAt = optionalTimestamp(input.revokedAt, "grant revocation time");
  const now = normalizeNow(options);
  assertTemporalValidity(checkedAt, expiresAt, revokedAt, now);
  const providerPolicyAllowsProcessing = optionalBoolean(
    input.providerPolicyAllowsProcessing,
    "grant provider-policy flag"
  );
  const output: RecommendationActivityPodsBoxGrantEvidence = {
    subjectId: boundedString(input.subjectId, "grant subject"),
    ...identity,
    boxType: normalizedBoxType,
    boxUri,
    requiredRight,
    rights,
    checkedAt
  };
  if (expiresAt !== undefined) output.expiresAt = expiresAt;
  if (providerPolicyAllowsProcessing !== undefined) {
    output.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  }
  return Object.freeze(output);
}

export function createRecommendationActivityPodsBoxReadAuthorization(
  evidence: RecommendationActivityPodsBoxGrantEvidence
): RecommendationProtocolSourceReadAuthorization {
  const normalized = normalizeRecommendationActivityPodsBoxGrantEvidence(evidence);
  const authorization: RecommendationProtocolSourceReadAuthorization = {
    status: "authorized",
    subjectId: normalized.subjectId,
    checkedAt: normalized.checkedAt,
    sourceVisibility: "acl_controlled",
    accessBasis: "solid_acl_read",
    containsPrivateData: true,
    containsThirdPartyData: true,
    serverSideProcessing: true
  };
  if (normalized.providerPolicyAllowsProcessing !== undefined) {
    authorization.providerPolicyAllowsProcessing = normalized.providerPolicyAllowsProcessing;
  }
  return Object.freeze(authorization);
}

export function normalizeRecommendationActivityPodsResourceGrantEvidence(
  input: RecommendationActivityPodsResourceGrantEvidenceInput,
  options: RecommendationActivityPodsGrantValidationOptions = {}
): RecommendationActivityPodsResourceGrantEvidence {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ActivityPods resource grant evidence.");
  const identity = normalizeIdentity(input);
  const resourceUri = normalizeHttpsUrl(input.resourceUri, "resource URI");
  assertSameOwnerAuthority(resourceUri, identity.ownerActorUri, "resource URI");
  const accessModes = uniqueKnownStrings<RecommendationSolidAccessMode>(
    input.accessModes,
    SOLID_ACCESS_MODE_SET,
    "resource access modes"
  );
  const isOwner = optionalBoolean(input.isOwner, "resource owner flag") ?? false;
  if (!isOwner && accessModes.every((mode) => mode === "none" || mode === "unknown" || mode === "append")) {
    throw new TypeError("ActivityPods resource grant does not provide usable access.");
  }
  const checkedAt = timestamp(input.checkedAt, "grant check time");
  const expiresAt = optionalTimestamp(input.expiresAt, "grant expiry time");
  const revokedAt = optionalTimestamp(input.revokedAt, "grant revocation time");
  const now = normalizeNow(options);
  assertTemporalValidity(checkedAt, expiresAt, revokedAt, now);
  const providerPolicyAllowsProcessing = optionalBoolean(
    input.providerPolicyAllowsProcessing,
    "grant provider-policy flag"
  );
  const output: RecommendationActivityPodsResourceGrantEvidence = {
    subjectId: boundedString(input.subjectId, "grant subject"),
    ...identity,
    resourceUri,
    accessModes,
    isOwner,
    checkedAt
  };
  if (expiresAt !== undefined) output.expiresAt = expiresAt;
  if (providerPolicyAllowsProcessing !== undefined) {
    output.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  }
  return Object.freeze(output);
}

export function requireRecommendationActivityPodsResourceOperation(
  evidence: RecommendationActivityPodsResourceGrantEvidence,
  operation: RecommendationActivityPodsResourceOperation
): RecommendationActivityPodsResourceGrantEvidence {
  const normalized = normalizeRecommendationActivityPodsResourceGrantEvidence(evidence);
  if (!RECOMMENDATION_ACTIVITYPODS_RESOURCE_OPERATIONS.includes(operation)) {
    throw new TypeError("Invalid ActivityPods resource operation.");
  }
  if (normalized.providerPolicyAllowsProcessing === false) {
    throw new TypeError("ActivityPods provider policy denies resource processing.");
  }
  if (normalized.isOwner) return normalized;
  const allowed = operation === "read"
    ? normalized.accessModes.includes("read") || normalized.accessModes.includes("control")
    : normalized.accessModes.includes("write") || normalized.accessModes.includes("control");
  if (!allowed) throw new TypeError(`ActivityPods resource grant does not allow ${operation}.`);
  return normalized;
}
