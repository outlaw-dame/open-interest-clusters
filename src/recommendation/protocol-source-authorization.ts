import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_PROTOCOLS,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type RecommendationAccessBasis,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import type {
  RecommendationProtocolSourceAdapterRecordReadResult,
  RecommendationProtocolSourceReadAuthorization
} from "./protocol-source-adapters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_PROTOCOL_SOURCE_AUTHORIZATION_EVIDENCE_KINDS = [
  "activitypub.public_web",
  "activitypub.authenticated_api",
  "activitypub.follower_relationship",
  "activitypub.mentioned_recipient",
  "activitypub.mutual_relationship",
  "activitypub.provider_policy",
  "activitypods.solid_acl_read",
  "activitypods.solid_acl_control",
  "activitypods.owner",
  "atproto.public_repo",
  "atproto.oauth_scope"
] as const;

export type RecommendationProtocolSourceAuthorizationEvidenceKind =
  typeof RECOMMENDATION_PROTOCOL_SOURCE_AUTHORIZATION_EVIDENCE_KINDS[number];

export interface RecommendationProtocolSourceAuthorizationEvidenceInput {
  kind: RecommendationProtocolSourceAuthorizationEvidenceKind;
  subjectId: string;
  checkedAt: string;
  sourceVisibility?: RecommendationSourceVisibility;
  accessBasis?: RecommendationAccessBasis;
  containsPrivateData?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationProtocolSourceAuthorizationEvidence {
  kind: RecommendationProtocolSourceAuthorizationEvidenceKind;
  protocol: RecommendationProtocol;
  subjectId: string;
  checkedAt: string;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  containsPrivateData: boolean;
  containsThirdPartyData: boolean;
  serverSideProcessing: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationProtocolSourceAdapterReadResultFromEvidenceInput<TRecord> {
  records: readonly TRecord[];
  evidence: RecommendationProtocolSourceAuthorizationEvidenceInput;
  cursor?: string;
}

interface AuthorizationEvidenceKindProfile {
  protocol: RecommendationProtocol;
  defaultSourceVisibility: RecommendationSourceVisibility;
  sourceVisibilities: readonly RecommendationSourceVisibility[];
  defaultAccessBasis: RecommendationAccessBasis;
  accessBases: readonly RecommendationAccessBasis[];
  defaultContainsPrivateData?: boolean;
  defaultContainsThirdPartyData: boolean;
  defaultServerSideProcessing: boolean;
}

const MAX_EVIDENCE_IDENTIFIER_LENGTH = 1_024;
const MAX_EVIDENCE_CURSOR_LENGTH = 1_024;
const MAX_EVIDENCE_RECORDS_PER_RESULT = 1_000;
const EVIDENCE_KIND_SET = new Set<string>(RECOMMENDATION_PROTOCOL_SOURCE_AUTHORIZATION_EVIDENCE_KINDS);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const SOURCE_VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);

function sourceVisibilities(
  ...values: readonly RecommendationSourceVisibility[]
): readonly RecommendationSourceVisibility[] {
  return Object.freeze([...values]);
}

function accessBases(...values: readonly RecommendationAccessBasis[]): readonly RecommendationAccessBasis[] {
  return Object.freeze([...values]);
}

const AUTHORIZATION_EVIDENCE_KIND_PROFILES: Readonly<
  Record<RecommendationProtocolSourceAuthorizationEvidenceKind, AuthorizationEvidenceKindProfile>
> = Object.freeze({
  "activitypub.public_web": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "public",
    sourceVisibilities: sourceVisibilities("public", "unlisted"),
    defaultAccessBasis: "public_web",
    accessBases: accessBases("public_web"),
    defaultContainsPrivateData: false,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: false
  }),
  "activitypub.authenticated_api": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "public",
    sourceVisibilities: sourceVisibilities("public", "unlisted"),
    defaultAccessBasis: "authenticated_api",
    accessBases: accessBases("authenticated_api"),
    defaultContainsPrivateData: false,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  }),
  "activitypub.follower_relationship": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "followers_only",
    sourceVisibilities: sourceVisibilities("followers_only"),
    defaultAccessBasis: "follower_relationship",
    accessBases: accessBases("follower_relationship", "mutual_relationship", "owner"),
    defaultContainsPrivateData: true,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  }),
  "activitypub.mentioned_recipient": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "mentioned_only",
    sourceVisibilities: sourceVisibilities("mentioned_only"),
    defaultAccessBasis: "mentioned_recipient",
    accessBases: accessBases("mentioned_recipient", "owner"),
    defaultContainsPrivateData: true,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  }),
  "activitypub.mutual_relationship": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "mutuals_only",
    sourceVisibilities: sourceVisibilities("mutuals_only", "followers_only"),
    defaultAccessBasis: "mutual_relationship",
    accessBases: accessBases("mutual_relationship", "owner"),
    defaultContainsPrivateData: true,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  }),
  "activitypub.provider_policy": Object.freeze({
    protocol: "activitypub",
    defaultSourceVisibility: "local_only",
    sourceVisibilities: sourceVisibilities("local_only"),
    defaultAccessBasis: "provider_policy",
    accessBases: accessBases("provider_policy"),
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  }),
  "activitypods.solid_acl_read": Object.freeze({
    protocol: "activitypods",
    defaultSourceVisibility: "acl_controlled",
    sourceVisibilities: sourceVisibilities("acl_controlled"),
    defaultAccessBasis: "solid_acl_read",
    accessBases: accessBases("solid_acl_read", "solid_acl_control", "owner"),
    defaultContainsPrivateData: true,
    defaultContainsThirdPartyData: false,
    defaultServerSideProcessing: true
  }),
  "activitypods.solid_acl_control": Object.freeze({
    protocol: "activitypods",
    defaultSourceVisibility: "acl_controlled",
    sourceVisibilities: sourceVisibilities("acl_controlled"),
    defaultAccessBasis: "solid_acl_control",
    accessBases: accessBases("solid_acl_control", "owner"),
    defaultContainsPrivateData: true,
    defaultContainsThirdPartyData: false,
    defaultServerSideProcessing: true
  }),
  "activitypods.owner": Object.freeze({
    protocol: "activitypods",
    defaultSourceVisibility: "acl_controlled",
    sourceVisibilities: sourceVisibilities(
      "public",
      "unlisted",
      "followers_only",
      "mentioned_only",
      "mutuals_only",
      "local_only",
      "acl_controlled"
    ),
    defaultAccessBasis: "owner",
    accessBases: accessBases("owner"),
    defaultContainsThirdPartyData: false,
    defaultServerSideProcessing: true
  }),
  "atproto.public_repo": Object.freeze({
    protocol: "atproto",
    defaultSourceVisibility: "atproto_public_repo",
    sourceVisibilities: sourceVisibilities("atproto_public_repo"),
    defaultAccessBasis: "atproto_public_repo",
    accessBases: accessBases("atproto_public_repo"),
    defaultContainsPrivateData: false,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: false
  }),
  "atproto.oauth_scope": Object.freeze({
    protocol: "atproto",
    defaultSourceVisibility: "atproto_public_repo",
    sourceVisibilities: sourceVisibilities("atproto_public_repo"),
    defaultAccessBasis: "oauth_scope",
    accessBases: accessBases("oauth_scope", "atproto_public_repo"),
    defaultContainsPrivateData: false,
    defaultContainsThirdPartyData: true,
    defaultServerSideProcessing: true
  })
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !hasUnsafeControlCharacter(value);
}

function requiredBoundedNonEmptyString(value: unknown, maxLength: number, label: string): string {
  if (!isBoundedNonEmptyString(value, maxLength)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function optionalBoundedNonEmptyString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedNonEmptyString(value, maxLength, label);
}

function normalizeCheckedAt(value: unknown): string {
  const checkedAt = requiredBoundedNonEmptyString(value, MAX_EVIDENCE_IDENTIFIER_LENGTH, "protocol authorization evidence timestamp");
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "protocol-authorization-evidence", since: checkedAt });
  return checkedAt;
}

function normalizeEvidenceKind(value: unknown): RecommendationProtocolSourceAuthorizationEvidenceKind {
  if (typeof value !== "string" || !EVIDENCE_KIND_SET.has(value)) {
    throw new TypeError("Invalid protocol authorization evidence kind.");
  }

  return value as RecommendationProtocolSourceAuthorizationEvidenceKind;
}

function normalizeSourceVisibility(value: unknown, profile: AuthorizationEvidenceKindProfile): RecommendationSourceVisibility {
  const sourceVisibility = value === undefined ? profile.defaultSourceVisibility : value;
  if (typeof sourceVisibility !== "string" || !SOURCE_VISIBILITY_SET.has(sourceVisibility)) {
    throw new TypeError("Invalid protocol authorization evidence visibility.");
  }

  if (!profile.sourceVisibilities.includes(sourceVisibility as RecommendationSourceVisibility)) {
    throw new TypeError("Protocol authorization evidence visibility is inconsistent with evidence kind.");
  }

  return sourceVisibility as RecommendationSourceVisibility;
}

function normalizeAccessBasis(value: unknown, profile: AuthorizationEvidenceKindProfile): RecommendationAccessBasis {
  const accessBasis = value === undefined ? profile.defaultAccessBasis : value;
  if (typeof accessBasis !== "string" || !ACCESS_BASIS_SET.has(accessBasis)) {
    throw new TypeError("Invalid protocol authorization evidence access basis.");
  }

  if (!profile.accessBases.includes(accessBasis as RecommendationAccessBasis)) {
    throw new TypeError("Protocol authorization evidence access basis is inconsistent with evidence kind.");
  }

  return accessBasis as RecommendationAccessBasis;
}

function normalizeBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function isPrivateVisibility(visibility: RecommendationSourceVisibility): boolean {
  return (
    visibility === "followers_only" ||
    visibility === "mentioned_only" ||
    visibility === "mutuals_only" ||
    visibility === "local_only" ||
    visibility === "acl_controlled"
  );
}

function effectiveBoolean(defaultValue: boolean, value: unknown, label: string): boolean {
  const normalized = normalizeBoolean(value, label);
  return defaultValue || normalized === true;
}

function optionalProviderPolicyFlag(value: unknown): boolean | undefined {
  return normalizeBoolean(value, "protocol authorization evidence provider-policy flag");
}

function assertKnownProfile(profile: AuthorizationEvidenceKindProfile): void {
  if (!PROTOCOL_SET.has(profile.protocol)) {
    throw new TypeError("Invalid protocol authorization evidence profile.");
  }
}

export function normalizeRecommendationProtocolSourceAuthorizationEvidence(
  input: RecommendationProtocolSourceAuthorizationEvidenceInput
): RecommendationProtocolSourceAuthorizationEvidence {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid protocol authorization evidence.");
  }

  const kind = normalizeEvidenceKind(input.kind);
  const profile = AUTHORIZATION_EVIDENCE_KIND_PROFILES[kind];
  assertKnownProfile(profile);

  const sourceVisibility = normalizeSourceVisibility(input.sourceVisibility, profile);
  const accessBasis = normalizeAccessBasis(input.accessBasis, profile);
  const defaultContainsPrivateData = profile.defaultContainsPrivateData ?? isPrivateVisibility(sourceVisibility);
  const evidence: RecommendationProtocolSourceAuthorizationEvidence = {
    kind,
    protocol: profile.protocol,
    subjectId: requiredBoundedNonEmptyString(
      input.subjectId,
      MAX_EVIDENCE_IDENTIFIER_LENGTH,
      "protocol authorization evidence subject"
    ),
    checkedAt: normalizeCheckedAt(input.checkedAt),
    sourceVisibility,
    accessBasis,
    containsPrivateData: effectiveBoolean(
      defaultContainsPrivateData,
      input.containsPrivateData,
      "protocol authorization evidence private-data flag"
    ),
    containsThirdPartyData: effectiveBoolean(
      profile.defaultContainsThirdPartyData,
      input.containsThirdPartyData,
      "protocol authorization evidence third-party-data flag"
    ),
    serverSideProcessing: effectiveBoolean(
      profile.defaultServerSideProcessing,
      input.serverSideProcessing,
      "protocol authorization evidence server-processing flag"
    )
  };
  const providerPolicyAllowsProcessing = optionalProviderPolicyFlag(input.providerPolicyAllowsProcessing);

  if (providerPolicyAllowsProcessing !== undefined) {
    evidence.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  }

  return Object.freeze(evidence);
}

export function createProtocolSourceReadAuthorizationFromEvidence(
  input: RecommendationProtocolSourceAuthorizationEvidenceInput
): RecommendationProtocolSourceReadAuthorization {
  const evidence = normalizeRecommendationProtocolSourceAuthorizationEvidence(input);
  const authorization: RecommendationProtocolSourceReadAuthorization = {
    status: "authorized",
    subjectId: evidence.subjectId,
    checkedAt: evidence.checkedAt,
    sourceVisibility: evidence.sourceVisibility,
    accessBasis: evidence.accessBasis,
    containsPrivateData: evidence.containsPrivateData,
    containsThirdPartyData: evidence.containsThirdPartyData,
    serverSideProcessing: evidence.serverSideProcessing
  };

  if (evidence.providerPolicyAllowsProcessing !== undefined) {
    authorization.providerPolicyAllowsProcessing = evidence.providerPolicyAllowsProcessing;
  }

  return Object.freeze(authorization);
}

export function createProtocolSourceAdapterReadResultFromAuthorizationEvidence<TRecord>(
  input: RecommendationProtocolSourceAdapterReadResultFromEvidenceInput<TRecord>
): RecommendationProtocolSourceAdapterRecordReadResult<TRecord> {
  if (!isPlainRecord(input) || !Array.isArray(input.records) || input.records.length > MAX_EVIDENCE_RECORDS_PER_RESULT) {
    throw new TypeError("Invalid protocol source adapter evidence read result.");
  }

  const cursor = optionalBoundedNonEmptyString(input.cursor, MAX_EVIDENCE_CURSOR_LENGTH, "protocol source adapter evidence cursor");
  const result: RecommendationProtocolSourceAdapterRecordReadResult<TRecord> = {
    records: Object.freeze([...input.records]) as readonly TRecord[],
    authorization: createProtocolSourceReadAuthorizationFromEvidence(input.evidence)
  };

  if (cursor !== undefined) {
    result.cursor = cursor;
  }

  return Object.freeze(result);
}
